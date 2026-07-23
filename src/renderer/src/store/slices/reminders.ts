import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { Reminder } from '../../../../shared/reminder-types'

// Why: a pushed full-list slice (not fetch-on-open) because the status-bar bell
// badge is always visible and must stay current without focus-refresh races;
// the list is capped small so the payload is trivial.
export type RemindersSlice = {
  reminders: Reminder[]
  remindersLoaded: boolean
  setReminders: (reminders: Reminder[]) => void
}

export const createRemindersSlice: StateCreator<AppState, [], [], RemindersSlice> = (set) => ({
  reminders: [],
  remindersLoaded: false,
  setReminders: (reminders) => set({ reminders, remindersLoaded: true })
})
