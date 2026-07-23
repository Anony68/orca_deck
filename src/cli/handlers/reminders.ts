import {
  buildReminderRecurrenceRrule,
  parseReminderAt,
  parseReminderDuration,
  type ReminderScheduleInput
} from '../../shared/reminder-schedule'
import type { Reminder } from '../../shared/reminder-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { formatReminderCreated, formatReminderList, formatReminderShow } from '../reminder-format'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeClient } from '../runtime-client'
import { resolveCurrentWorktreeSelector } from '../selectors'

function parseScheduleFlags(flags: Map<string, string | boolean>): ReminderScheduleInput | null {
  const inFlag = getOptionalStringFlag(flags, 'in')
  const atFlag = getOptionalStringFlag(flags, 'at')
  const everyFlag = getOptionalStringFlag(flags, 'every')
  if (inFlag && (atFlag || everyFlag)) {
    throw new RuntimeClientError('invalid_argument', 'Use either --in, --at, or --every.')
  }
  if (inFlag) {
    const minutes = parseReminderDuration(inFlag)
    if (minutes === null) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Invalid --in duration: ${inFlag}. Use forms like 30m, 1h30m, or 2d.`
      )
    }
    return { kind: 'relative', minutes }
  }
  if (everyFlag) {
    const at = atFlag ? parseReminderAt(atFlag) : null
    if (atFlag && (!at || at.year !== undefined)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--every takes a time of day for --at (like 09:30), got: ${atFlag}`
      )
    }
    const rrule = buildReminderRecurrenceRrule({
      every: everyFlag,
      hour: at?.hour ?? 9,
      minute: at?.minute ?? 0
    })
    if (!rrule) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Invalid --every value: ${everyFlag}. Use hour, day, weekdays, week, a day name, cron, or an RRULE.`
      )
    }
    return { kind: 'recurring', rrule }
  }
  if (atFlag) {
    const at = parseReminderAt(atFlag)
    if (!at) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Invalid --at time: ${atFlag}. Use HH:MM, 3:30pm, or "YYYY-MM-DD HH:MM".`
      )
    }
    return at
  }
  return null
}

async function resolveReminderWorkspace(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: RuntimeClient
): Promise<string | undefined> {
  if (flags.get('no-workspace') === true) {
    return undefined
  }
  const explicit = getOptionalStringFlag(flags, 'workspace')
  if (explicit) {
    return explicit
  }
  // Why: linking is best-effort — a reminder created outside any Orca worktree
  // is still valid, it just loses click-to-focus.
  try {
    return await resolveCurrentWorktreeSelector(cwd, client)
  } catch {
    return undefined
  }
}

export const REMINDER_HANDLERS: Record<string, CommandHandler> = {
  remind: async ({ flags, client, cwd, json }) => {
    const schedule = parseScheduleFlags(flags)
    if (!schedule) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Missing schedule: pass --in <duration>, --at <time>, or --every <freq>.'
      )
    }
    const result = await client.call<{ reminder: Reminder }>('reminder.create', {
      message: getRequiredStringFlag(flags, 'message'),
      schedule,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workspace: await resolveReminderWorkspace(flags, cwd, client)
    })
    printResult(result, json, formatReminderCreated)
  },
  'reminders list': async ({ flags, client, json }) => {
    const result = await client.call<{ reminders: Reminder[] }>('reminder.list')
    printResult(result, json, (value) => formatReminderList(value, flags.get('all') === true))
  },
  'reminders show': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const result = await client.call<{ reminders: Reminder[] }>('reminder.list')
    const reminder = findReminderByIdPrefix(result.result.reminders, id)
    printResult({ ...result, result: { reminder } }, json, formatReminderShow)
  },
  'reminders done': async ({ flags, client, json }) => {
    const id = await resolveFullReminderId(client, getRequiredStringFlag(flags, 'id'))
    const result = await client.call<{ reminder: Reminder }>('reminder.complete', { id })
    printResult(result, json, formatReminderShow)
  },
  'reminders cancel': async ({ flags, client, json }) => {
    const id = await resolveFullReminderId(client, getRequiredStringFlag(flags, 'id'))
    const result = await client.call<{ reminder: Reminder }>('reminder.cancel', { id })
    printResult(result, json, formatReminderShow)
  },
  'reminders edit': async ({ flags, client, json }) => {
    const id = await resolveFullReminderId(client, getRequiredStringFlag(flags, 'id'))
    const message = getOptionalStringFlag(flags, 'message')
    const schedule = parseScheduleFlags(flags)
    if (message === undefined && !schedule) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Nothing to edit: pass --message and/or a schedule (--in/--at/--every).'
      )
    }
    const result = await client.call<{ reminder: Reminder }>('reminder.update', {
      id,
      ...(message !== undefined ? { message } : {}),
      ...(schedule ? { schedule } : {})
    })
    printResult(result, json, formatReminderShow)
  }
}

function findReminderByIdPrefix(reminders: Reminder[], idOrPrefix: string): Reminder {
  const matches = reminders.filter(
    (reminder) => reminder.id === idOrPrefix || reminder.id.startsWith(idOrPrefix)
  )
  if (matches.length === 1) {
    return matches[0]
  }
  throw new RuntimeClientError(
    matches.length === 0 ? 'selector_not_found' : 'invalid_argument',
    matches.length === 0
      ? `No reminder matches id: ${idOrPrefix}`
      : `Reminder id prefix is ambiguous: ${idOrPrefix}`
  )
}

// Why: list rows print 8-char id prefixes; management commands accept them back.
async function resolveFullReminderId(client: RuntimeClient, idOrPrefix: string): Promise<string> {
  const result = await client.call<{ reminders: Reminder[] }>('reminder.list')
  return findReminderByIdPrefix(result.result.reminders, idOrPrefix).id
}
