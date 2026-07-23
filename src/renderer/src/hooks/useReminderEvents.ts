import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { showReminderFiredToast } from '@/components/reminders/reminder-fired-toast'

/** Hydrates the reminders slice, subscribes to main-pushed updates, and
 *  surfaces fired reminders as toasts. Mounted once at the App root. */
export function useReminderEvents(): void {
  useEffect(() => {
    if (!window.api.reminders) {
      return
    }
    let disposed = false
    const unsubscribeChanged = window.api.reminders.onChanged((reminders) => {
      useAppStore.getState().setReminders(reminders)
    })
    const unsubscribeFired = window.api.reminders.onFired((payload) => {
      showReminderFiredToast(payload)
    })
    void window.api.reminders
      .list()
      .then((reminders) => {
        if (!disposed) {
          useAppStore.getState().setReminders(reminders)
        }
      })
      // Why: rendererReady flushes queued catch-up fires; it must run after the
      // listeners above are attached so those payloads land in this session.
      .then(() => window.api.reminders.rendererReady())
      .catch(() => {})
    return () => {
      disposed = true
      unsubscribeChanged()
      unsubscribeFired()
    }
  }, [])
}
