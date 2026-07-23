import { useEffect, useState } from 'react'
import { ReminderDialog } from './ReminderDialog'

// Why: the create dialog must open from global surfaces (Cmd+J) even when the
// status-bar bell segment is toggled off, so one always-mounted host owns it.
const OPEN_REMINDER_DIALOG_EVENT = 'orca-open-reminder-dialog'

export function requestOpenReminderDialog(): void {
  window.dispatchEvent(new Event(OPEN_REMINDER_DIALOG_EVENT))
}

export function RemindersDialogHost(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener(OPEN_REMINDER_DIALOG_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_REMINDER_DIALOG_EVENT, onOpen)
  }, [])
  return <ReminderDialog open={open} reminder={null} onOpenChange={setOpen} />
}
