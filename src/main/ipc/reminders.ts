import { ipcMain } from 'electron'
import type { ReminderService } from '../reminders/service'
import type {
  Reminder,
  ReminderCreateInput,
  ReminderUpdateInput
} from '../../shared/reminder-types'

export function registerReminderHandlers(service: ReminderService): void {
  ipcMain.handle('reminders:list', (): Reminder[] => service.list())
  ipcMain.handle(
    'reminders:create',
    (_event, input: ReminderCreateInput): Reminder => service.create(input)
  )
  ipcMain.handle(
    'reminders:update',
    (_event, args: { id: string; updates: ReminderUpdateInput }): Reminder =>
      service.update(args.id, args.updates)
  )
  ipcMain.handle(
    'reminders:complete',
    (_event, args: { id: string }): Reminder => service.complete(args.id)
  )
  ipcMain.handle(
    'reminders:dismiss',
    (_event, args: { id: string }): Reminder => service.dismiss(args.id)
  )
  ipcMain.handle('reminders:delete', (_event, args: { id: string }): void => {
    service.delete(args.id)
  })
  ipcMain.handle('reminders:rendererReady', (): void => {
    service.setRendererReady()
  })
}
