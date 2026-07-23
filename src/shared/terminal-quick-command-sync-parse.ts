import {
  isTerminalAgentQuickCommand,
  MAX_QUICK_COMMANDS,
  normalizeTerminalQuickCommands
} from './terminal-quick-commands'
import type { TerminalQuickCommand, TerminalQuickCommandScope } from './types'

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

function isNormalizedTerminalQuickCommandScope(
  value: unknown,
  expected: TerminalQuickCommandScope
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const scope = value as Record<string, unknown>
  if (expected.type === 'global') {
    return hasExactKeys(scope, ['type']) && scope.type === 'global'
  }
  return (
    hasExactKeys(scope, ['type', 'repoId']) &&
    scope.type === 'repo' &&
    scope.repoId === expected.repoId
  )
}

function isNormalizedTerminalQuickCommand(value: unknown, expected: TerminalQuickCommand): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const command = value as Record<string, unknown>
  if (
    command.id !== expected.id ||
    command.label !== expected.label ||
    !isNormalizedTerminalQuickCommandScope(command.scope, expected.scope ?? { type: 'global' })
  ) {
    return false
  }
  if (isTerminalAgentQuickCommand(expected)) {
    return (
      hasExactKeys(command, ['id', 'label', 'action', 'agent', 'prompt', 'scope']) &&
      command.action === 'agent-prompt' &&
      command.agent === expected.agent &&
      command.prompt === expected.prompt
    )
  }
  return (
    hasExactKeys(
      command,
      expected.runInActiveTab
        ? ['id', 'label', 'action', 'command', 'appendEnter', 'runInActiveTab', 'scope']
        : ['id', 'label', 'action', 'command', 'appendEnter', 'scope']
    ) &&
    command.action === 'terminal-command' &&
    command.command === expected.command &&
    command.appendEnter === expected.appendEnter &&
    command.runInActiveTab === expected.runInActiveTab
  )
}

// Why: a full-list client must reject any "authoritative" payload that would
// change under normalization, or its next mutation could persist silent loss.
export function parseNormalizedTerminalQuickCommands(
  input: unknown
): TerminalQuickCommand[] | null {
  if (!Array.isArray(input) || input.length > MAX_QUICK_COMMANDS) {
    return null
  }
  const normalized = normalizeTerminalQuickCommands(input)
  if (
    normalized.length !== input.length ||
    normalized.some((command, index) => !isNormalizedTerminalQuickCommand(input[index], command))
  ) {
    return null
  }
  return normalized
}
