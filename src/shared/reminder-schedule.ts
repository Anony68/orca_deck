import {
  buildAutomationRrule,
  formatAutomationSchedule,
  isValidAutomationSchedule,
  nextAutomationOccurrenceAfter
} from './automation-schedules'
import type { Reminder, ReminderRecurrence } from './reminder-types'

export const REMINDER_MIN_RELATIVE_MINUTES = 1
export const REMINDER_MAX_RELATIVE_MINUTES = 366 * 24 * 60

/** Structured schedule intent. Epoch resolution happens on the app host so a
 *  CLI running on an SSH remote never bakes in the remote's clock/timezone. */
export type ReminderScheduleInput =
  | { kind: 'relative'; minutes: number }
  | { kind: 'absolute'; year?: number; month?: number; day?: number; hour: number; minute: number }
  | { kind: 'recurring'; rrule: string }

const DURATION_RE = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?:in)?)?$/i
const BARE_MINUTES_RE = /^\d+$/
const TIME_24H_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const TIME_12H_RE = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)$/i
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T]+(.+)$/

/** Parse "30m", "1h30m", "2d", "45" (bare = minutes). Null when invalid or out of range. */
export function parseReminderDuration(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }
  let minutes: number
  if (BARE_MINUTES_RE.test(trimmed)) {
    minutes = Number(trimmed)
  } else {
    const match = DURATION_RE.exec(trimmed)
    if (!match || (!match[1] && !match[2] && !match[3])) {
      return null
    }
    minutes = Number(match[1] ?? 0) * 24 * 60 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  }
  if (minutes < REMINDER_MIN_RELATIVE_MINUTES || minutes > REMINDER_MAX_RELATIVE_MINUTES) {
    return null
  }
  return minutes
}

type ParsedWallClock = { hour: number; minute: number }

function parseWallClock(text: string): ParsedWallClock | null {
  const trimmed = text.trim()
  const t24 = TIME_24H_RE.exec(trimmed)
  if (t24) {
    return { hour: Number(t24[1]), minute: Number(t24[2]) }
  }
  const t12 = TIME_12H_RE.exec(trimmed)
  if (t12) {
    const rawHour = Number(t12[1]) % 12
    const hour = t12[3].toLowerCase() === 'pm' ? rawHour + 12 : rawHour
    return { hour, minute: Number(t12[2] ?? 0) }
  }
  return null
}

/** Parse "HH:MM", "3pm", "3:30pm", or "YYYY-MM-DD HH:MM" into an absolute intent. */
export function parseReminderAt(
  text: string
): Extract<ReminderScheduleInput, { kind: 'absolute' }> | null {
  const trimmed = text.trim()
  const dated = DATE_TIME_RE.exec(trimmed)
  if (dated) {
    const clock = parseWallClock(dated[4])
    if (!clock) {
      return null
    }
    const year = Number(dated[1])
    const month = Number(dated[2])
    const day = Number(dated[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null
    }
    return { kind: 'absolute', year, month, day, ...clock }
  }
  const clock = parseWallClock(trimmed)
  return clock ? { kind: 'absolute', ...clock } : null
}

const EVERY_PRESET_DAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

/** Build an rrule from an `--every` value; raw cron/RRULE passes through when valid. */
export function buildReminderRecurrenceRrule(args: {
  every: string
  hour: number
  minute: number
}): string | null {
  const every = args.every.trim().toLowerCase()
  const { hour, minute } = args
  if (every === 'hour' || every === 'hourly') {
    return buildAutomationRrule({ preset: 'hourly', hour, minute })
  }
  if (every === 'day' || every === 'daily') {
    return buildAutomationRrule({ preset: 'daily', hour, minute })
  }
  if (every === 'weekday' || every === 'weekdays') {
    return buildAutomationRrule({ preset: 'weekdays', hour, minute })
  }
  if (every === 'week' || every === 'weekly') {
    return buildAutomationRrule({ preset: 'weekly', hour, minute })
  }
  const dayOfWeek = EVERY_PRESET_DAYS[every] ?? EVERY_PRESET_DAYS[every.replace(/s$/, '')]
  if (dayOfWeek !== undefined) {
    return buildAutomationRrule({ preset: 'weekly', hour, minute, dayOfWeek })
  }
  return isValidAutomationSchedule(args.every.trim()) ? args.every.trim() : null
}

export type ResolvedReminderSchedule = {
  dueAt: number
  recurrence: ReminderRecurrence | null
}

/** Resolve an intent to a concrete due time using the app host's clock. */
export function resolveReminderSchedule(
  input: ReminderScheduleInput,
  now: number
): ResolvedReminderSchedule {
  if (input.kind === 'relative') {
    return { dueAt: now + input.minutes * 60_000, recurrence: null }
  }
  if (input.kind === 'recurring') {
    return {
      dueAt: nextAutomationOccurrenceAfter(input.rrule, now, now),
      recurrence: { rrule: input.rrule, dtstart: now }
    }
  }
  const base = new Date(now)
  if (input.year !== undefined && input.month !== undefined && input.day !== undefined) {
    const dated = new Date(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute,
      0,
      0
    ).getTime()
    return { dueAt: dated, recurrence: null }
  }
  base.setHours(input.hour, input.minute, 0, 0)
  let dueAt = base.getTime()
  // Why: a bare time already past today means the next occurrence, tomorrow.
  if (dueAt <= now) {
    dueAt += 24 * 60 * 60 * 1000
  }
  return { dueAt, recurrence: null }
}

/** Human label for CLI list rows and dialog previews. */
export function describeReminderSchedule(reminder: Pick<Reminder, 'dueAt' | 'recurrence'>): string {
  if (reminder.recurrence) {
    return formatAutomationSchedule(reminder.recurrence.rrule)
  }
  return new Date(reminder.dueAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Compact "in 2h 12m" / "3m overdue" label. */
export function describeReminderDueDelta(dueAt: number, now: number): string {
  const deltaMs = dueAt - now
  const overdue = deltaMs < 0
  const totalMinutes = Math.max(1, Math.round(Math.abs(deltaMs) / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`)
  }
  const span = parts.join(' ') || '1m'
  return overdue ? `${span} overdue` : `in ${span}`
}
