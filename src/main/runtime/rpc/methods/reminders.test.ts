import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { REMINDER_METHODS } from './reminders'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeRuntime(): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'test-runtime',
    listReminders: vi.fn().mockReturnValue([]),
    createReminder: vi.fn((input: unknown) => ({ id: 'r1', ...(input as object) })),
    updateReminder: vi.fn((id: string, updates: unknown) => ({ id, ...(updates as object) })),
    completeReminder: vi.fn((id: string) => ({ id, status: 'completed' })),
    dismissReminder: vi.fn((id: string) => ({ id, status: 'dismissed' })),
    deleteReminder: vi.fn(),
    showManagedWorktree: vi.fn().mockResolvedValue({ id: 'repo::wt1' })
  } as unknown as OrcaRuntimeService
}

describe('reminder RPC methods', () => {
  let runtime: OrcaRuntimeService
  let dispatcher: RpcDispatcher

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 10, 0, 0, 0))
    runtime = makeRuntime()
    dispatcher = new RpcDispatcher({ runtime, methods: REMINDER_METHODS })
  })

  it('creates a relative reminder resolving the epoch on this host', async () => {
    const response = await dispatcher.dispatch(
      makeRequest('reminder.create', {
        message: 'Check the deploy',
        schedule: { kind: 'relative', minutes: 30 },
        workspace: 'id:repo::wt1'
      })
    )
    expect(response).toMatchObject({ ok: true })
    expect(runtime.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Check the deploy',
        dueAt: Date.now() + 30 * 60_000,
        recurrence: null,
        worktreeId: 'repo::wt1',
        createdVia: 'cli'
      })
    )
  })

  it('creates a recurring reminder with a validated rrule', async () => {
    const response = await dispatcher.dispatch(
      makeRequest('reminder.create', {
        message: 'Standup',
        schedule: { kind: 'recurring', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30' }
      })
    )
    expect(response).toMatchObject({ ok: true })
    expect(runtime.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: expect.objectContaining({ rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=30' }),
        worktreeId: null
      })
    )
  })

  it('rejects invalid schedules, empty messages, and oversized delays', async () => {
    const invalid = [
      { message: '', schedule: { kind: 'relative', minutes: 30 } },
      { message: 'x'.repeat(501), schedule: { kind: 'relative', minutes: 30 } },
      { message: 'ok', schedule: { kind: 'relative', minutes: 0 } },
      { message: 'ok', schedule: { kind: 'relative', minutes: 9_999_999 } },
      { message: 'ok', schedule: { kind: 'absolute', hour: 24, minute: 0 } },
      { message: 'ok', schedule: { kind: 'recurring', rrule: 'not-a-schedule' } },
      { message: 'ok' }
    ]
    for (const params of invalid) {
      const response = await dispatcher.dispatch(makeRequest('reminder.create', params))
      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    expect(runtime.createReminder).not.toHaveBeenCalled()
  })

  it('routes lifecycle operations to the runtime', async () => {
    await dispatcher.dispatch(makeRequest('reminder.list'))
    await dispatcher.dispatch(makeRequest('reminder.complete', { id: 'r1' }))
    await dispatcher.dispatch(makeRequest('reminder.cancel', { id: 'r1' }))
    await dispatcher.dispatch(makeRequest('reminder.delete', { id: 'r1' }))
    await dispatcher.dispatch(
      makeRequest('reminder.update', {
        id: 'r1',
        schedule: { kind: 'relative', minutes: 10 }
      })
    )

    expect(runtime.listReminders).toHaveBeenCalled()
    expect(runtime.completeReminder).toHaveBeenCalledWith('r1')
    expect(runtime.dismissReminder).toHaveBeenCalledWith('r1')
    expect(runtime.deleteReminder).toHaveBeenCalledWith('r1')
    expect(runtime.updateReminder).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ dueAt: Date.now() + 10 * 60_000, status: 'pending' })
    )
  })
})
