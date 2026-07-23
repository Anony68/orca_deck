import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const REMINDER_SCHEDULE_FLAGS = ['in', 'at', 'every']

// Why: ordering is load-bearing — normalizeCommandPositionals returns on the
// first matching spec, so the aliased management specs must precede the bare
// `remind <message>` create spec or `orca remind list` parses as a create
// with message "list".
export const REMINDER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['reminders', 'list'],
    aliases: [['remind', 'list']],
    summary: 'List reminders',
    usage: 'orca reminders list [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'all'],
    notes: ['Shows pending and fired reminders; --all includes completed, dismissed, and missed.'],
    examples: ['orca reminders list', 'orca reminders list --all --json']
  },
  {
    path: ['reminders', 'show'],
    aliases: [['remind', 'show']],
    summary: 'Show one reminder',
    usage: 'orca reminders show <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca reminders show 2f9e', 'orca reminders show 2f9e --json']
  },
  {
    path: ['reminders', 'done'],
    aliases: [['remind', 'done']],
    summary: 'Mark a reminder done',
    usage: 'orca reminders done <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: ['Completing a recurring reminder stops the whole series.'],
    examples: ['orca reminders done 2f9e']
  },
  {
    path: ['reminders', 'cancel'],
    aliases: [['remind', 'cancel']],
    summary: 'Cancel a reminder without marking it done',
    usage: 'orca reminders cancel <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca reminders cancel 2f9e']
  },
  {
    path: ['reminders', 'edit'],
    aliases: [['remind', 'edit']],
    summary: 'Edit a reminder message or schedule',
    usage:
      'orca reminders edit <id> [--message <text>] [--in <duration>|--at <time>|--every <freq> [--at <time>]] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'message', ...REMINDER_SCHEDULE_FLAGS],
    positionalArgs: ['id'],
    notes: ['Changing the schedule re-arms the reminder (status returns to pending).'],
    examples: [
      'orca reminders edit 2f9e --in 1h',
      'orca reminders edit 2f9e --message "Call Bob back"'
    ]
  },
  {
    path: ['remind'],
    summary: 'Create a reminder that notifies on desktop and paired phones',
    usage:
      'orca remind "<message>" (--in <duration> | --at <time> | --every <freq> [--at <time>]) [--workspace <selector>|--no-workspace] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'message',
      ...REMINDER_SCHEDULE_FLAGS,
      'workspace',
      'no-workspace'
    ],
    positionalArgs: ['message'],
    notes: [
      '--in accepts 30m, 1h30m, 2d, or a bare integer (minutes).',
      '--at accepts HH:MM (24h), 3pm, 3:30pm, or "YYYY-MM-DD HH:MM"; a bare time already past today means tomorrow. Wall times resolve against the Orca desktop clock.',
      '--every accepts hour, day, weekday(s), week, monday..sunday (time from --at, default 09:00), a 5-field cron expression, or an RRULE string.',
      'The reminder is linked to the enclosing Orca workspace when one contains the current directory; use --workspace <selector> to override or --no-workspace to skip linking.',
      'For a message that collides with a subcommand name (list, done, ...), pass it via --message.'
    ],
    examples: [
      'orca remind "Check the deploy" --in 30m',
      'orca remind "Call Bob" --at "2026-07-24 15:00"',
      'orca remind "Standup" --every weekdays --at 09:30'
    ]
  }
]
