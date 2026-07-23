import { describe, expect, it } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from './args'
import { COMMAND_SPECS } from './specs'

function normalize(argv: string[]): ReturnType<typeof normalizeCommandPositionals> {
  return normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
}

describe('reminder CLI spec ordering', () => {
  // Why: normalizeCommandPositionals returns on the first matching spec, so the
  // aliased management specs must precede the bare `remind <message>` create
  // spec — otherwise `orca remind list` becomes a create with message "list".
  it('routes management verbs through the remind alias instead of create', () => {
    expect(normalize(['remind', 'list']).commandPath).toEqual(['reminders', 'list'])
    expect(normalize(['reminders', 'list']).commandPath).toEqual(['reminders', 'list'])

    const done = normalize(['remind', 'done', '2f9e'])
    expect(done.commandPath).toEqual(['reminders', 'done'])
    expect(done.flags.get('id')).toBe('2f9e')

    const edit = normalize(['reminders', 'edit', '2f9e', '--in', '1h'])
    expect(edit.commandPath).toEqual(['reminders', 'edit'])
    expect(edit.flags.get('id')).toBe('2f9e')
    expect(edit.flags.get('in')).toBe('1h')
  })

  it('treats a non-verb positional as the reminder message', () => {
    const create = normalize(['remind', 'buy milk', '--in', '30m'])
    expect(create.commandPath).toEqual(['remind'])
    expect(create.flags.get('message')).toBe('buy milk')
    expect(create.flags.get('in')).toBe('30m')
  })

  it('lets --message carry values that collide with subcommand names', () => {
    const create = normalize(['remind', '--message', 'list', '--in', '30m'])
    expect(create.commandPath).toEqual(['remind'])
    expect(create.flags.get('message')).toBe('list')
  })

  it('parses --no-workspace as a boolean flag', () => {
    const create = normalize(['remind', 'ping', '--in', '5m', '--no-workspace'])
    expect(create.flags.get('no-workspace')).toBe(true)
    expect(create.flags.get('message')).toBe('ping')
  })
})
