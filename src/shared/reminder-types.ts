export const REMINDER_MESSAGE_MAX_LENGTH = 500
export const MAX_PENDING_REMINDERS = 200
export const MAX_SETTLED_REMINDERS = 100
// Why: parity with automations' run_once_within_grace default (12h) so a
// laptop that slept overnight still surfaces this morning's reminder.
export const REMINDER_DEFAULT_GRACE_MINUTES = 720

export type ReminderStatus = 'pending' | 'fired' | 'completed' | 'dismissed' | 'missed'

/** Statuses a reminder can never fire from again; only these are safe to prune. */
export function isSettledReminderStatus(status: ReminderStatus): boolean {
  return status === 'completed' || status === 'dismissed' || status === 'missed'
}

export type ReminderRecurrence = {
  /** Automation-schedule grammar: RRULE preset string or 5-field cron. */
  rrule: string
  dtstart: number
}

export type Reminder = {
  id: string
  message: string
  status: ReminderStatus
  /** Epoch ms of the next occurrence — the scheduler key (mirrors Automation.nextRunAt). */
  dueAt: number
  /** Null = one-shot. */
  recurrence: ReminderRecurrence | null
  /** IANA timezone captured at creation. Informational: occurrence math is
   *  host-local wall time, matching automations. */
  timezone: string
  /** Source workspace for notification click-to-focus; kept even if the worktree is later deleted. */
  worktreeId: string | null
  createdVia: 'cli' | 'ui'
  missedFireGraceMinutes: number
  /** Last delivered occurrence — duplicate-fire guard and catch-up watermark. */
  lastFiredAt: number | null
  firedCount: number
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export type ReminderCreateInput = {
  message: string
  dueAt: number
  recurrence: ReminderRecurrence | null
  timezone?: string
  worktreeId?: string | null
  createdVia: 'cli' | 'ui'
}

export type ReminderUpdateInput = Partial<
  Pick<Reminder, 'message' | 'dueAt' | 'recurrence' | 'status' | 'worktreeId'>
>

export type ReminderFiredPayload = {
  reminder: Reminder
  /** Epoch ms of the occurrence this delivery represents. */
  occurrence: number
  overdue: boolean
}

const REMINDER_STATUSES: readonly ReminderStatus[] = [
  'pending',
  'fired',
  'completed',
  'dismissed',
  'missed'
]

function normalizeReminder(value: unknown): Reminder | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) {
    return null
  }
  if (typeof record.message !== 'string' || !record.message.trim()) {
    return null
  }
  if (typeof record.dueAt !== 'number' || !Number.isFinite(record.dueAt)) {
    return null
  }
  const status = REMINDER_STATUSES.includes(record.status as ReminderStatus)
    ? (record.status as ReminderStatus)
    : 'pending'
  const rawRecurrence = record.recurrence as Record<string, unknown> | null | undefined
  const recurrence: ReminderRecurrence | null =
    rawRecurrence &&
    typeof rawRecurrence === 'object' &&
    typeof rawRecurrence.rrule === 'string' &&
    typeof rawRecurrence.dtstart === 'number'
      ? { rrule: rawRecurrence.rrule, dtstart: rawRecurrence.dtstart }
      : null
  const finiteNumber = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return {
    id: record.id,
    message: record.message.slice(0, REMINDER_MESSAGE_MAX_LENGTH),
    status,
    dueAt: record.dueAt,
    recurrence,
    timezone: typeof record.timezone === 'string' ? record.timezone : 'UTC',
    worktreeId: typeof record.worktreeId === 'string' ? record.worktreeId : null,
    createdVia: record.createdVia === 'ui' ? 'ui' : 'cli',
    missedFireGraceMinutes: Math.max(
      1,
      finiteNumber(record.missedFireGraceMinutes, REMINDER_DEFAULT_GRACE_MINUTES)
    ),
    lastFiredAt:
      typeof record.lastFiredAt === 'number' && Number.isFinite(record.lastFiredAt)
        ? record.lastFiredAt
        : null,
    firedCount: Math.max(0, Math.floor(finiteNumber(record.firedCount, 0))),
    completedAt:
      typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)
        ? record.completedAt
        : null,
    createdAt: finiteNumber(record.createdAt, 0),
    updatedAt: finiteNumber(record.updatedAt, 0)
  }
}

export function normalizeReminders(input: unknown): Reminder[] {
  if (!Array.isArray(input)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: Reminder[] = []
  for (const item of input) {
    const reminder = normalizeReminder(item)
    if (reminder && !seen.has(reminder.id)) {
      seen.add(reminder.id)
      normalized.push(reminder)
    }
  }
  return normalized
}
