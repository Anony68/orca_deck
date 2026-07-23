import type { AutomationSchedulePreset } from '../../../../shared/automations-types'
import {
  buildAutomationRrule,
  tryParseAutomationRrule
} from '../../../../shared/automation-schedules'
import {
  resolveReminderSchedule,
  type ReminderScheduleInput,
  type ResolvedReminderSchedule
} from '../../../../shared/reminder-schedule'
import type { Reminder } from '../../../../shared/reminder-types'

export type ReminderOncePreset = 'in-15m' | 'in-1h' | 'in-3h' | 'tomorrow-9' | 'custom'
export type ReminderRepeatPreset = Exclude<AutomationSchedulePreset, 'custom'>

export type ReminderDraft = {
  message: string
  mode: 'once' | 'repeat'
  oncePreset: ReminderOncePreset
  /** Optional YYYY-MM-DD for the custom one-shot; empty = today/tomorrow rollover. */
  date: string
  /** HH:MM (24h) shared by the custom one-shot and repeat modes. */
  time: string
  repeatPreset: ReminderRepeatPreset
  dayOfWeek: string
}

export const REMINDER_ONCE_PRESET_MINUTES: Record<string, number> = {
  'in-15m': 15,
  'in-1h': 60,
  'in-3h': 180
}

export function parseReminderTimeInput(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map((part) => Number(part))
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0
  }
}

export function formatReminderTimeInput(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function getReminderClockParts(time: string): {
  hour12: number
  minute: number
  period: 'AM' | 'PM'
} {
  const { hour, minute } = parseReminderTimeInput(time)
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    minute,
    period: hour >= 12 ? 'PM' : 'AM'
  }
}

export function updateReminderTimePart(
  time: string,
  patch: { hour12?: number; minute?: number; period?: 'AM' | 'PM' }
): string {
  const current = getReminderClockParts(time)
  const nextHour12 = patch.hour12 ?? current.hour12
  const nextPeriod = patch.period ?? current.period
  const nextMinute = patch.minute ?? current.minute
  const hour24 =
    nextPeriod === 'AM'
      ? nextHour12 === 12
        ? 0
        : nextHour12
      : nextHour12 === 12
        ? 12
        : nextHour12 + 12
  return formatReminderTimeInput(hour24, nextMinute)
}

export function createReminderDraft(reminder?: Reminder): ReminderDraft {
  if (!reminder) {
    return {
      message: '',
      mode: 'once',
      oncePreset: 'in-15m',
      date: '',
      time: '09:00',
      repeatPreset: 'daily',
      dayOfWeek: '1'
    }
  }
  if (reminder.recurrence) {
    const parsed = tryParseAutomationRrule(reminder.recurrence.rrule)
    return {
      message: reminder.message,
      mode: 'repeat',
      oncePreset: 'custom',
      date: '',
      time: formatReminderTimeInput(parsed?.hour ?? 9, parsed?.minute ?? 0),
      repeatPreset: parsed?.preset === 'custom' ? 'daily' : (parsed?.preset ?? 'daily'),
      dayOfWeek: String(parsed?.dayOfWeek ?? 1)
    }
  }
  const due = new Date(reminder.dueAt)
  return {
    message: reminder.message,
    mode: 'once',
    oncePreset: 'custom',
    date: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
    time: formatReminderTimeInput(due.getHours(), due.getMinutes()),
    repeatPreset: 'daily',
    dayOfWeek: '1'
  }
}

export function buildReminderScheduleInput(
  draft: ReminderDraft,
  now: number
): ReminderScheduleInput | null {
  if (draft.mode === 'repeat') {
    const { hour, minute } = parseReminderTimeInput(draft.time)
    return {
      kind: 'recurring',
      rrule: buildAutomationRrule({
        preset: draft.repeatPreset,
        hour,
        minute,
        dayOfWeek: Number(draft.dayOfWeek)
      })
    }
  }
  const presetMinutes = REMINDER_ONCE_PRESET_MINUTES[draft.oncePreset]
  if (presetMinutes !== undefined) {
    return { kind: 'relative', minutes: presetMinutes }
  }
  if (draft.oncePreset === 'tomorrow-9') {
    const tomorrow = new Date(now + 24 * 60 * 60 * 1000)
    return {
      kind: 'absolute',
      year: tomorrow.getFullYear(),
      month: tomorrow.getMonth() + 1,
      day: tomorrow.getDate(),
      hour: 9,
      minute: 0
    }
  }
  const { hour, minute } = parseReminderTimeInput(draft.time)
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date.trim())
  if (draft.date.trim() && !dateMatch) {
    return null
  }
  if (dateMatch) {
    return {
      kind: 'absolute',
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour,
      minute
    }
  }
  return { kind: 'absolute', hour, minute }
}

export function resolveReminderDraft(
  draft: ReminderDraft,
  now: number
): ResolvedReminderSchedule | null {
  const input = buildReminderScheduleInput(draft, now)
  if (!input) {
    return null
  }
  const resolved = resolveReminderSchedule(input, now)
  // Why: an explicit past date/time would fire instantly as "overdue"; treat it
  // as invalid input instead so the preview flags it before save.
  if (!resolved.recurrence && resolved.dueAt <= now) {
    return null
  }
  return resolved
}

export function describeReminderDraft(draft: ReminderDraft, now: number): string | null {
  const resolved = resolveReminderDraft(draft, now)
  if (!resolved) {
    return null
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(resolved.dueAt)
}

export function isReminderDraftSavable(draft: ReminderDraft, now: number): boolean {
  return draft.message.trim().length > 0 && resolveReminderDraft(draft, now) !== null
}
