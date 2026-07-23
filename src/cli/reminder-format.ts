import { describeReminderDueDelta, describeReminderSchedule } from '../shared/reminder-schedule'
import { isSettledReminderStatus, type Reminder } from '../shared/reminder-types'

const REMINDER_ID_PREVIEW_LENGTH = 8

function reminderStatusLabel(reminder: Reminder): string {
  if (reminder.status === 'pending' && reminder.recurrence) {
    return 'repeats'
  }
  return reminder.status
}

export function formatReminderLine(reminder: Reminder, now = Date.now()): string {
  const id = reminder.id.slice(0, REMINDER_ID_PREVIEW_LENGTH)
  const due =
    reminder.status === 'pending' || reminder.status === 'fired'
      ? `${describeReminderSchedule(reminder)} (${describeReminderDueDelta(reminder.dueAt, now)})`
      : describeReminderSchedule(reminder)
  return `${id}  [${reminderStatusLabel(reminder)}]  ${due}  ${reminder.message}`
}

export function formatReminderList(
  result: { reminders: Reminder[] },
  includeSettled = false
): string {
  const visible = includeSettled
    ? result.reminders
    : result.reminders.filter((reminder) => !isSettledReminderStatus(reminder.status))
  if (visible.length === 0) {
    return includeSettled ? 'No reminders.' : 'No active reminders.'
  }
  return visible.map((reminder) => formatReminderLine(reminder)).join('\n')
}

export function formatReminderCreated(result: { reminder: Reminder }): string {
  const { reminder } = result
  const schedule = reminder.recurrence
    ? describeReminderSchedule(reminder)
    : `${describeReminderSchedule(reminder)} (${describeReminderDueDelta(reminder.dueAt, Date.now())})`
  return `Reminder set for ${schedule}\n${formatReminderLine(reminder)}`
}

export function formatReminderShow(result: { reminder: Reminder }): string {
  return formatReminderLine(result.reminder)
}
