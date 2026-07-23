import { toast } from 'sonner'
import type { ReminderFiredPayload } from '../../../../shared/reminder-types'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'

const SNOOZE_MINUTES = 10

export function reminderFiredToastId(payload: ReminderFiredPayload): string {
  return `reminder-${payload.reminder.id}-${payload.occurrence}`
}

export function navigateToReminderWorktree(worktreeId: string | null): void {
  // Why: worktreeId is "repoId::path"; without the separator there is no repo to reveal.
  if (worktreeId && worktreeId.includes('::')) {
    activateAndRevealWorktree(worktreeId)
  }
}

export function showReminderFiredToast(payload: ReminderFiredPayload): void {
  const { reminder } = payload
  const title = payload.overdue
    ? translate('auto.components.reminders.reminder.fired.toast.a91c47e3d2', 'Overdue reminder')
    : translate('auto.components.reminders.reminder.fired.toast.c58b21f9e4', 'Reminder')
  const canSnooze = reminder.recurrence === null
  toast.warning(title, {
    id: reminderFiredToastId(payload),
    description: reminder.message,
    // Why: a due reminder must not silently expire off-screen; recurring
    // occurrences self-resolve at the next fire, one-shots wait for the user.
    duration: canSnooze ? Infinity : undefined,
    action: {
      label: translate('auto.components.reminders.reminder.fired.toast.b24f96c1a7', 'Done'),
      onClick: () => {
        void window.api.reminders.complete({ id: reminder.id })
      }
    },
    ...(canSnooze
      ? {
          cancel: {
            label: translate(
              'auto.components.reminders.reminder.fired.toast.e73d5a12b8',
              'Snooze 10m'
            ),
            onClick: () => {
              void window.api.reminders.update({
                id: reminder.id,
                updates: { dueAt: Date.now() + SNOOZE_MINUTES * 60_000, status: 'pending' }
              })
            }
          }
        }
      : {})
  })
}
