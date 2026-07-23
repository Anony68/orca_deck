import { describe, expect, it } from 'vitest'
import {
  buildReminderRecurrenceRrule,
  parseReminderAt,
  parseReminderDuration,
  resolveReminderSchedule
} from './reminder-schedule'

describe('parseReminderDuration', () => {
  it('parses compound and bare durations as minutes', () => {
    expect(parseReminderDuration('30m')).toBe(30)
    expect(parseReminderDuration('1h30m')).toBe(90)
    expect(parseReminderDuration('2d')).toBe(2 * 24 * 60)
    expect(parseReminderDuration('2d1h5m')).toBe(2 * 24 * 60 + 65)
    expect(parseReminderDuration('45')).toBe(45)
    expect(parseReminderDuration(' 15min ')).toBe(15)
  })

  it('rejects zero, garbage, and out-of-range durations', () => {
    expect(parseReminderDuration('0m')).toBeNull()
    expect(parseReminderDuration('')).toBeNull()
    expect(parseReminderDuration('soon')).toBeNull()
    expect(parseReminderDuration('9999d')).toBeNull()
    expect(parseReminderDuration('-5m')).toBeNull()
  })
})

describe('parseReminderAt', () => {
  it('parses 24h, 12h, and dated forms', () => {
    expect(parseReminderAt('09:30')).toEqual({ kind: 'absolute', hour: 9, minute: 30 })
    expect(parseReminderAt('3pm')).toEqual({ kind: 'absolute', hour: 15, minute: 0 })
    expect(parseReminderAt('3:45 PM')).toEqual({ kind: 'absolute', hour: 15, minute: 45 })
    expect(parseReminderAt('12:05am')).toEqual({ kind: 'absolute', hour: 0, minute: 5 })
    expect(parseReminderAt('2026-07-24 15:00')).toEqual({
      kind: 'absolute',
      year: 2026,
      month: 7,
      day: 24,
      hour: 15,
      minute: 0
    })
  })

  it('rejects invalid times and dates', () => {
    expect(parseReminderAt('25:00')).toBeNull()
    expect(parseReminderAt('13pm')).toBeNull()
    expect(parseReminderAt('2026-13-01 09:00')).toBeNull()
    expect(parseReminderAt('later')).toBeNull()
  })
})

describe('buildReminderRecurrenceRrule', () => {
  it('maps presets and passes valid cron through', () => {
    expect(buildReminderRecurrenceRrule({ every: 'day', hour: 9, minute: 30 })).toBe(
      'FREQ=DAILY;BYHOUR=9;BYMINUTE=30'
    )
    expect(buildReminderRecurrenceRrule({ every: 'weekdays', hour: 9, minute: 0 })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0'
    )
    expect(buildReminderRecurrenceRrule({ every: 'monday', hour: 8, minute: 15 })).toBe(
      'FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=15'
    )
    expect(buildReminderRecurrenceRrule({ every: '0 9 * * 1-5', hour: 0, minute: 0 })).toBe(
      '0 9 * * 1-5'
    )
    expect(buildReminderRecurrenceRrule({ every: 'fortnight', hour: 9, minute: 0 })).toBeNull()
  })
})

describe('resolveReminderSchedule', () => {
  const now = new Date(2026, 6, 23, 10, 0, 0, 0).getTime()

  it('resolves relative schedules from now', () => {
    expect(resolveReminderSchedule({ kind: 'relative', minutes: 30 }, now)).toEqual({
      dueAt: now + 30 * 60_000,
      recurrence: null
    })
  })

  it('rolls a bare past time to tomorrow and keeps a future time today', () => {
    const past = resolveReminderSchedule({ kind: 'absolute', hour: 9, minute: 0 }, now)
    expect(new Date(past.dueAt).getDate()).toBe(24)
    expect(new Date(past.dueAt).getHours()).toBe(9)

    const future = resolveReminderSchedule({ kind: 'absolute', hour: 15, minute: 0 }, now)
    expect(new Date(future.dueAt).getDate()).toBe(23)
    expect(new Date(future.dueAt).getHours()).toBe(15)
  })

  it('resolves dated schedules to the exact local wall time', () => {
    const dated = resolveReminderSchedule(
      { kind: 'absolute', year: 2026, month: 7, day: 24, hour: 15, minute: 0 },
      now
    )
    expect(dated.dueAt).toBe(new Date(2026, 6, 24, 15, 0, 0, 0).getTime())
  })

  it('anchors recurring schedules to the next occurrence after now', () => {
    const resolved = resolveReminderSchedule(
      { kind: 'recurring', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      now
    )
    expect(resolved.recurrence).toEqual({
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: now
    })
    // Why: 09:00 already passed at the 10:00 anchor, so the next fire is tomorrow.
    expect(new Date(resolved.dueAt).getDate()).toBe(24)
    expect(new Date(resolved.dueAt).getHours()).toBe(9)
  })

  it('keeps daily local wall time across the US DST spring-forward boundary', () => {
    const beforeDst = new Date(2026, 2, 7, 12, 0, 0, 0).getTime()
    const resolved = resolveReminderSchedule(
      { kind: 'recurring', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
      beforeDst
    )
    const first = new Date(resolved.dueAt)
    expect(first.getHours()).toBe(9)
  })
})
