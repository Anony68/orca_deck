import { z } from 'zod'
import { isValidAutomationSchedule } from '../../../../shared/automation-schedules'
import {
  REMINDER_MAX_RELATIVE_MINUTES,
  resolveReminderSchedule
} from '../../../../shared/reminder-schedule'
import { REMINDER_MESSAGE_MAX_LENGTH } from '../../../../shared/reminder-types'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'

const ReminderScheduleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('relative'),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(REMINDER_MAX_RELATIVE_MINUTES, { message: 'Reminder delay is too far out' })
  }),
  z.object({
    kind: z.literal('absolute'),
    year: z.number().int().min(1970).max(9999).optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  z.object({
    kind: z.literal('recurring'),
    rrule: requiredString('Missing recurrence rule').refine(isValidAutomationSchedule, {
      message: 'Invalid recurrence rule'
    })
  })
])

const ReminderMessage = requiredString('Missing reminder message').refine(
  (value) => value.trim().length > 0 && value.length <= REMINDER_MESSAGE_MAX_LENGTH,
  { message: `Reminder message must be 1-${REMINDER_MESSAGE_MAX_LENGTH} characters` }
)

const ReminderId = z.object({ id: requiredString('Missing reminder id') })

const ReminderCreate = z.object({
  message: ReminderMessage,
  schedule: ReminderScheduleInputSchema,
  timezone: OptionalString,
  workspace: OptionalString
})

const ReminderUpdate = z.object({
  id: requiredString('Missing reminder id'),
  message: ReminderMessage.optional(),
  schedule: ReminderScheduleInputSchema.optional()
})

export const REMINDER_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'reminder.list',
    params: null,
    handler: (_params, { runtime }) => ({ reminders: runtime.listReminders() })
  }),
  defineMethod({
    name: 'reminder.create',
    params: ReminderCreate,
    handler: async (params, { runtime }) => {
      // Why: the schedule intent (not an epoch) crosses the wire, so SSH-remote
      // clock or timezone skew can't shift the fire time — resolve on this host.
      const resolved = resolveReminderSchedule(params.schedule, Date.now())
      const worktreeId = params.workspace
        ? (await runtime.showManagedWorktree(params.workspace)).id
        : null
      return {
        reminder: runtime.createReminder({
          message: params.message,
          dueAt: resolved.dueAt,
          recurrence: resolved.recurrence,
          timezone: params.timezone,
          worktreeId,
          createdVia: 'cli'
        })
      }
    }
  }),
  defineMethod({
    name: 'reminder.update',
    params: ReminderUpdate,
    handler: (params, { runtime }) => {
      const resolved = params.schedule ? resolveReminderSchedule(params.schedule, Date.now()) : null
      return {
        reminder: runtime.updateReminder(params.id, {
          ...(params.message !== undefined ? { message: params.message } : {}),
          ...(resolved
            ? { dueAt: resolved.dueAt, recurrence: resolved.recurrence, status: 'pending' as const }
            : {})
        })
      }
    }
  }),
  defineMethod({
    name: 'reminder.complete',
    params: ReminderId,
    handler: (params, { runtime }) => ({ reminder: runtime.completeReminder(params.id) })
  }),
  defineMethod({
    name: 'reminder.cancel',
    params: ReminderId,
    handler: (params, { runtime }) => ({ reminder: runtime.dismissReminder(params.id) })
  }),
  defineMethod({
    name: 'reminder.delete',
    params: ReminderId,
    handler: (params, { runtime }) => runtime.deleteReminder(params.id)
  })
]
