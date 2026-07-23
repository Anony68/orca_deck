import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reminder } from '../../shared/reminder-types'

const powerMonitorOnMock = vi.hoisted(() => vi.fn())
const powerMonitorRemoveMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  powerMonitor: { on: powerMonitorOnMock, removeListener: powerMonitorRemoveMock }
}))
// Why: the real dispatch module drags in Electron Notification/tray imports;
// the service under test receives an injected dispatcher instead.
vi.mock('../ipc/notification-dispatch', () => ({
  getActiveNotificationDispatcher: () => null
}))

import { ReminderService, reminderNotificationId } from './service'

const BASE = new Date(2026, 6, 23, 10, 0, 0, 0).getTime()
const GRACE_MINUTES = 720

function makeReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: 'r1',
    message: 'Water the plants',
    status: 'pending',
    dueAt: BASE - 60_000,
    recurrence: null,
    timezone: 'UTC',
    worktreeId: null,
    createdVia: 'cli',
    missedFireGraceMinutes: GRACE_MINUTES,
    lastFiredAt: null,
    firedCount: 0,
    completedAt: null,
    createdAt: BASE - 3_600_000,
    updatedAt: BASE - 3_600_000,
    ...overrides
  }
}

type FakeStore = {
  reminders: Reminder[]
  eventLog: string[]
  listReminders: () => Reminder[]
  markReminderFired: (id: string, args: { occurrence: number; nextDueAt?: number }) => Reminder
  settleReminderMissed: (id: string) => Reminder
  completeReminder: (id: string) => Reminder
  dismissReminder: (id: string) => Reminder
  deleteReminder: (id: string) => void
  updateReminder: (id: string, updates: Partial<Reminder>) => Reminder
  createReminder: (input: unknown) => Reminder
  getWorktreeMeta: (worktreeId: string) => { displayName: string } | undefined
}

function makeStore(reminders: Reminder[]): FakeStore {
  const store: FakeStore = {
    reminders: [...reminders],
    eventLog: [],
    listReminders: () => [...store.reminders].sort((a, b) => a.dueAt - b.dueAt),
    markReminderFired: (id, args) => {
      const index = store.reminders.findIndex((entry) => entry.id === id)
      const current = store.reminders[index]
      const updated: Reminder = {
        ...current,
        status: args.nextDueAt !== undefined ? 'pending' : 'fired',
        dueAt: args.nextDueAt ?? current.dueAt,
        lastFiredAt: args.occurrence,
        firedCount: current.firedCount + 1,
        updatedAt: Date.now()
      }
      store.reminders[index] = updated
      store.eventLog.push(`flush:markFired:${id}`)
      return updated
    },
    settleReminderMissed: (id) => {
      const index = store.reminders.findIndex((entry) => entry.id === id)
      store.reminders[index] = { ...store.reminders[index], status: 'missed' }
      store.eventLog.push(`flush:missed:${id}`)
      return store.reminders[index]
    },
    completeReminder: (id) => {
      const index = store.reminders.findIndex((entry) => entry.id === id)
      store.reminders[index] = { ...store.reminders[index], status: 'completed' }
      return store.reminders[index]
    },
    dismissReminder: (id) => {
      const index = store.reminders.findIndex((entry) => entry.id === id)
      store.reminders[index] = { ...store.reminders[index], status: 'dismissed' }
      return store.reminders[index]
    },
    deleteReminder: (id) => {
      store.reminders = store.reminders.filter((entry) => entry.id !== id)
    },
    updateReminder: (id, updates) => {
      const index = store.reminders.findIndex((entry) => entry.id === id)
      store.reminders[index] = { ...store.reminders[index], ...updates }
      return store.reminders[index]
    },
    createReminder: () => {
      throw new Error('not used')
    },
    getWorktreeMeta: () => undefined
  }
  return store
}

function makeService(store: FakeStore): {
  service: ReminderService
  dispatchMock: ReturnType<typeof vi.fn>
  sendMock: ReturnType<typeof vi.fn>
} {
  const dispatchMock = vi.fn((args: unknown) => {
    store.eventLog.push(
      `dispatch:${(args as { notificationId?: string }).notificationId ?? 'unknown'}`
    )
    return { delivered: true }
  })
  const service = new ReminderService(store as never, {
    getDispatcher: () => ({ dispatchNotification: dispatchMock, dismissNotificationsById: vi.fn() })
  })
  const sendMock = vi.fn()
  service.setWebContents({ send: sendMock } as never)
  return { service, dispatchMock, sendMock }
}

describe('ReminderService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE)
    powerMonitorOnMock.mockClear()
    powerMonitorRemoveMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a due one-shot, persisting the fired state before dispatching', () => {
    const reminder = makeReminder({})
    const store = makeStore([reminder])
    const { service, dispatchMock, sendMock } = makeService(store)
    service.setRendererReady()

    expect(store.reminders[0].status).toBe('fired')
    expect(store.reminders[0].lastFiredAt).toBe(reminder.dueAt)
    // Why: persist-before-notify is the duplicate-fire guard across restarts.
    expect(store.eventLog).toEqual([
      'flush:markFired:r1',
      `dispatch:${reminderNotificationId('r1', reminder.dueAt)}`
    ])
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'reminder',
        reminderMessage: 'Water the plants',
        reminderOverdue: false
      })
    )
    expect(sendMock).toHaveBeenCalledWith(
      'reminders:fired',
      expect.objectContaining({ occurrence: reminder.dueAt, overdue: false })
    )

    // Second evaluation must not fire again.
    dispatchMock.mockClear()
    service.evaluateDueReminders()
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('marks an overdue-within-grace fire as overdue', () => {
    const reminder = makeReminder({ dueAt: BASE - 10 * 60_000 })
    const store = makeStore([reminder])
    const { service, dispatchMock } = makeService(store)
    service.setRendererReady()

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ reminderOverdue: true }))
  })

  it('settles a one-shot past its grace window as missed without dispatching', () => {
    const reminder = makeReminder({ dueAt: BASE - (GRACE_MINUTES + 1) * 60_000 })
    const store = makeStore([reminder])
    const { service, dispatchMock } = makeService(store)
    service.setRendererReady()

    expect(store.reminders[0].status).toBe('missed')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('advances a recurring reminder and delivers only the latest occurrence', () => {
    const dtstart = BASE - 3 * 24 * 60 * 60 * 1000
    const reminder = makeReminder({
      recurrence: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstart },
      dueAt: new Date(2026, 6, 23, 9, 0, 0, 0).getTime()
    })
    const store = makeStore([reminder])
    const { service, dispatchMock } = makeService(store)
    service.setRendererReady()

    const todayNine = new Date(2026, 6, 23, 9, 0, 0, 0).getTime()
    const tomorrowNine = new Date(2026, 6, 24, 9, 0, 0, 0).getTime()
    expect(store.reminders[0].status).toBe('pending')
    expect(store.reminders[0].dueAt).toBe(tomorrowNine)
    expect(store.reminders[0].lastFiredAt).toBe(todayNine)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: reminderNotificationId('r1', todayNine) })
    )
  })

  it('queues fired payloads until the renderer is ready', () => {
    const reminder = makeReminder({})
    const store = makeStore([reminder])
    const { service, sendMock } = makeService(store)

    service.evaluateDueReminders()
    expect(sendMock).not.toHaveBeenCalledWith('reminders:fired', expect.anything())

    service.setRendererReady()
    expect(sendMock).toHaveBeenCalledWith(
      'reminders:fired',
      expect.objectContaining({ occurrence: reminder.dueAt })
    )
  })

  it('re-evaluates on power resume and stops cleanly', () => {
    const store = makeStore([])
    const { service } = makeService(store)
    service.start()
    expect(powerMonitorOnMock).toHaveBeenCalledWith('resume', expect.any(Function))
    service.stop()
    expect(powerMonitorRemoveMock).toHaveBeenCalledWith('resume', expect.any(Function))
  })
})
