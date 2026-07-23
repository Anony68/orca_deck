import { describe, expect, it } from 'vitest'
import type { Reminder } from '../../../../shared/reminder-types'
import {
  buildReminderScheduleInput,
  createReminderDraft,
  isReminderDraftSavable,
  resolveReminderDraft,
  updateReminderTimePart
} from './reminder-dialog-state'

const NOW = new Date(2026, 6, 23, 10, 0, 0, 0).getTime()

function makeReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: 'r1',
    message: 'Water the plants',
    status: 'pending',
    dueAt: new Date(2026, 6, 24, 15, 30, 0, 0).getTime(),
    recurrence: null,
    timezone: 'UTC',
    worktreeId: null,
    createdVia: 'ui',
    missedFireGraceMinutes: 720,
    lastFiredAt: null,
    firedCount: 0,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

describe('reminder dialog state', () => {
  it('maps relative presets to relative schedule inputs', () => {
    const draft = createReminderDraft()
    expect(buildReminderScheduleInput(draft, NOW)).toEqual({ kind: 'relative', minutes: 15 })
    expect(buildReminderScheduleInput({ ...draft, oncePreset: 'in-1h' }, NOW)).toEqual({
      kind: 'relative',
      minutes: 60
    })
  })

  it('maps tomorrow-9 to a dated absolute input', () => {
    const draft = { ...createReminderDraft(), oncePreset: 'tomorrow-9' as const }
    expect(buildReminderScheduleInput(draft, NOW)).toEqual({
      kind: 'absolute',
      year: 2026,
      month: 7,
      day: 24,
      hour: 9,
      minute: 0
    })
  })

  it('builds recurring rrules from the repeat controls', () => {
    const draft = {
      ...createReminderDraft(),
      mode: 'repeat' as const,
      repeatPreset: 'weekdays' as const,
      time: '09:30'
    }
    expect(buildReminderScheduleInput(draft, NOW)).toEqual({
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30'
    })
  })

  it('rejects explicit past one-shot times instead of firing them instantly', () => {
    const draft = {
      ...createReminderDraft(),
      oncePreset: 'custom' as const,
      date: '2026-07-22',
      time: '09:00'
    }
    expect(resolveReminderDraft(draft, NOW)).toBeNull()
    expect(isReminderDraftSavable({ ...draft, message: 'x' }, NOW)).toBe(false)
  })

  it('requires a non-empty message to save', () => {
    const draft = createReminderDraft()
    expect(isReminderDraftSavable(draft, NOW)).toBe(false)
    expect(isReminderDraftSavable({ ...draft, message: 'water plants' }, NOW)).toBe(true)
  })

  it('prefills the draft from an existing one-shot reminder', () => {
    const draft = createReminderDraft(makeReminder({}))
    expect(draft.mode).toBe('once')
    expect(draft.oncePreset).toBe('custom')
    expect(draft.date).toBe('2026-07-24')
    expect(draft.time).toBe('15:30')
  })

  it('prefills repeat controls from a recurring reminder rrule', () => {
    const draft = createReminderDraft(
      makeReminder({
        recurrence: {
          rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=15',
          dtstart: NOW
        }
      })
    )
    expect(draft.mode).toBe('repeat')
    expect(draft.repeatPreset).toBe('weekly')
    expect(draft.dayOfWeek).toBe('1')
    expect(draft.time).toBe('08:15')
  })

  it('round-trips 12h clock edits through updateReminderTimePart', () => {
    expect(updateReminderTimePart('09:00', { period: 'PM' })).toBe('21:00')
    expect(updateReminderTimePart('21:30', { hour12: 12, period: 'AM' })).toBe('00:30')
    expect(updateReminderTimePart('00:05', { period: 'PM' })).toBe('12:05')
  })
})
