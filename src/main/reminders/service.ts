import { powerMonitor, type WebContents } from 'electron'
import type { Store } from '../persistence'
import type {
  Reminder,
  ReminderCreateInput,
  ReminderFiredPayload,
  ReminderUpdateInput
} from '../../shared/reminder-types'
import {
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter
} from '../../shared/automation-schedules'
import {
  getActiveNotificationDispatcher,
  type NotificationDispatcherHandle
} from '../ipc/notification-dispatch'

// Why: finer than automations' 60s — reminders are latency-sensitive ("in 1m").
const DEFAULT_TICK_MS = 30 * 1000
// Why: a fire more than this late reads as "overdue" in the notification copy.
const OVERDUE_LABEL_THRESHOLD_MS = 90 * 1000

export function reminderNotificationId(reminderId: string, occurrence: number): string {
  return `reminder:${reminderId}:${occurrence}`
}

export class ReminderService {
  private readonly store: Store
  private readonly tickMs: number
  private readonly getDispatcher: () => NotificationDispatcherHandle | null
  private timer: ReturnType<typeof setInterval> | null = null
  private webContents: WebContents | null = null
  private rendererReady = false
  private evaluating = false
  private resumeListener: (() => void) | null = null
  // Why: catch-up can fire before the renderer attaches; queue toasts until it does.
  private pendingFiredPayloads: ReminderFiredPayload[] = []

  constructor(
    store: Store,
    opts: {
      tickMs?: number
      getDispatcher?: () => NotificationDispatcherHandle | null
    } = {}
  ) {
    this.store = store
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS
    this.getDispatcher = opts.getDispatcher ?? getActiveNotificationDispatcher
  }

  setWebContents(webContents: WebContents | null): void {
    this.webContents = webContents
    this.rendererReady = false
  }

  setRendererReady(): void {
    this.rendererReady = true
    const queued = this.pendingFiredPayloads
    this.pendingFiredPayloads = []
    for (const payload of queued) {
      this.webContents?.send('reminders:fired', payload)
    }
    this.notifyChanged()
    this.evaluateDueReminders()
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      this.evaluateDueReminders()
    }, this.tickMs)
    // Why: setInterval doesn't run during OS sleep; re-evaluate on wake so a
    // reminder due mid-sleep fires within seconds of resume, not a full tick.
    this.resumeListener = () => this.evaluateDueReminders()
    powerMonitor.on('resume', this.resumeListener)
    this.evaluateDueReminders()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.resumeListener) {
      powerMonitor.removeListener('resume', this.resumeListener)
      this.resumeListener = null
    }
  }

  list(): Reminder[] {
    return this.store.listReminders()
  }

  create(input: ReminderCreateInput): Reminder {
    const reminder = this.store.createReminder(input)
    this.notifyChanged()
    this.evaluateDueReminders()
    return reminder
  }

  update(id: string, updates: ReminderUpdateInput): Reminder {
    const reminder = this.store.updateReminder(id, updates)
    this.notifyChanged()
    this.evaluateDueReminders()
    return reminder
  }

  complete(id: string): Reminder {
    const reminder = this.store.completeReminder(id)
    if (reminder.lastFiredAt !== null) {
      // Why: done means done everywhere — close the live desktop banner and paired phones.
      this.getDispatcher()?.dismissNotificationsById([
        reminderNotificationId(reminder.id, reminder.lastFiredAt)
      ])
    }
    this.notifyChanged()
    return reminder
  }

  dismiss(id: string): Reminder {
    const reminder = this.store.dismissReminder(id)
    this.notifyChanged()
    return reminder
  }

  delete(id: string): void {
    this.store.deleteReminder(id)
    this.notifyChanged()
  }

  notifyChanged(): void {
    this.webContents?.send('reminders:changed', this.store.listReminders())
  }

  evaluateDueReminders(): void {
    if (this.evaluating) {
      return
    }
    this.evaluating = true
    try {
      const now = Date.now()
      let changed = false
      for (const reminder of this.store.listReminders()) {
        if (reminder.status !== 'pending' || reminder.dueAt > now) {
          continue
        }
        changed = true
        const graceMs = reminder.missedFireGraceMinutes * 60_000
        if (reminder.recurrence) {
          const occurrence =
            latestAutomationOccurrenceAtOrBefore(
              reminder.recurrence.rrule,
              reminder.recurrence.dtstart,
              now
            ) ?? reminder.dueAt
          // Why: persist-before-notify — a crash between flush and delivery
          // loses one banner instead of duplicating it after restart.
          this.store.markReminderFired(reminder.id, {
            occurrence,
            nextDueAt: nextAutomationOccurrenceAfter(
              reminder.recurrence.rrule,
              reminder.recurrence.dtstart,
              now
            )
          })
          // Why: run_once_within_grace parity — deliver only the latest missed
          // occurrence; older ones advance silently.
          if (now - occurrence <= graceMs) {
            this.deliver({ ...reminder, lastFiredAt: occurrence }, occurrence, now)
          }
          continue
        }
        if (now - reminder.dueAt > graceMs) {
          this.store.settleReminderMissed(reminder.id)
          continue
        }
        this.store.markReminderFired(reminder.id, { occurrence: reminder.dueAt })
        this.deliver(reminder, reminder.dueAt, now)
      }
      if (changed) {
        this.notifyChanged()
      }
    } finally {
      this.evaluating = false
    }
  }

  private deliver(reminder: Reminder, occurrence: number, now: number): void {
    const overdue = now - occurrence > OVERDUE_LABEL_THRESHOLD_MS
    const worktreeLabel = reminder.worktreeId
      ? this.store.getWorktreeMeta(reminder.worktreeId)?.displayName
      : undefined
    void this.getDispatcher()?.dispatchNotification({
      source: 'reminder',
      notificationId: reminderNotificationId(reminder.id, occurrence),
      worktreeId: reminder.worktreeId ?? undefined,
      worktreeLabel,
      reminderMessage: reminder.message,
      reminderDueAt: occurrence,
      reminderOverdue: overdue
    })
    const payload: ReminderFiredPayload = { reminder, occurrence, overdue }
    if (this.rendererReady && this.webContents) {
      this.webContents.send('reminders:fired', payload)
    } else {
      this.pendingFiredPayloads.push(payload)
    }
  }
}
