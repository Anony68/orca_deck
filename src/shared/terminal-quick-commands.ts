import { isTuiAgent, TUI_AGENT_CONFIG } from './tui-agent-config'
import type {
  TerminalAgentQuickCommand,
  TerminalCommandQuickCommand,
  TerminalQuickCommand,
  TerminalQuickCommandAction,
  TerminalQuickCommandScope
} from './types'

export const MAX_QUICK_COMMANDS = 40
export const MAX_QUICK_COMMAND_ID_LENGTH = 80
export const MAX_QUICK_COMMAND_LABEL_LENGTH = 80
export const MAX_QUICK_COMMAND_REPO_ID_LENGTH = 200
export const MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH = 4000
// Why: agent prompt quick commands still launch through startup commands for
// argv/flag agents, so this must stay within Orca's Windows shell safety cap.
export const MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH = 6000
const REMOVED_PRESET_IDS = new Set(['default-pwd', 'default-git-status'])

// Why: labels are persisted user data (editable/deletable), so they stay plain
// strings rather than i18n keys. Shapes must round-trip normalization exactly
// or parseNormalizedTerminalQuickCommands rejects full-list sync payloads.
const DEFAULT_TERMINAL_QUICK_COMMANDS: TerminalCommandQuickCommand[] = [
  {
    id: 'claude-preset-run',
    label: 'Run Claude',
    action: 'terminal-command',
    command: 'claude',
    appendEnter: true,
    scope: { type: 'global' }
  },
  {
    id: 'claude-preset-continue',
    label: 'Continue last session',
    action: 'terminal-command',
    command: 'claude -c',
    appendEnter: true,
    scope: { type: 'global' }
  },
  {
    id: 'claude-preset-resume',
    label: 'Pick a session',
    action: 'terminal-command',
    command: 'claude -r',
    appendEnter: true,
    scope: { type: 'global' }
  },
  {
    id: 'claude-preset-skip-permissions',
    label: 'Run skipping permissions (dangerous)',
    action: 'terminal-command',
    command: 'claude --dangerously-skip-permissions',
    appendEnter: true,
    scope: { type: 'global' }
  },
  {
    id: 'claude-preset-update',
    label: 'Update Claude',
    action: 'terminal-command',
    command: 'claude update',
    appendEnter: true,
    scope: { type: 'global' }
  }
]

export type TerminalQuickCommandMutation =
  | { type: 'upsert'; command: TerminalQuickCommand }
  | { type: 'delete'; id: string }

export function getDefaultTerminalQuickCommands(): TerminalQuickCommand[] {
  return DEFAULT_TERMINAL_QUICK_COMMANDS.map((command) => ({
    ...command,
    scope: { type: 'global' }
  }))
}

// Why: profiles that persisted a quick-command array before the Claude presets
// shipped get them merged once at load (guarded by
// terminalQuickCommandsClaudePresetsSeeded) so a deleted preset never returns.
export function seedDefaultTerminalQuickCommands(
  commands: readonly TerminalQuickCommand[]
): TerminalQuickCommand[] {
  const existingIds = new Set(commands.map((command) => command.id))
  const seeded = [...commands]
  for (const preset of getDefaultTerminalQuickCommands()) {
    if (seeded.length >= MAX_QUICK_COMMANDS) {
      break
    }
    if (!existingIds.has(preset.id)) {
      seeded.push(preset)
    }
  }
  return seeded
}

function normalizeTerminalQuickCommandScope(input: unknown): TerminalQuickCommandScope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { type: 'global' }
  }
  const record = input as Record<string, unknown>
  if (record.type !== 'repo') {
    return { type: 'global' }
  }
  const repoId = typeof record.repoId === 'string' ? record.repoId.trim() : ''
  if (!repoId) {
    return { type: 'global' }
  }
  return { type: 'repo', repoId: repoId.slice(0, MAX_QUICK_COMMAND_REPO_ID_LENGTH) }
}

export function getTerminalQuickCommandScope(
  command: TerminalQuickCommand
): TerminalQuickCommandScope {
  return normalizeTerminalQuickCommandScope(command.scope)
}

export function terminalQuickCommandMatchesRepo(
  command: TerminalQuickCommand,
  repoId: string | null
): boolean {
  const scope = getTerminalQuickCommandScope(command)
  return scope.type === 'global' || (repoId !== null && scope.repoId === repoId)
}

export function getTerminalQuickCommandAction(
  command: TerminalQuickCommand
): TerminalQuickCommandAction {
  return command.action === 'agent-prompt' ? 'agent-prompt' : 'terminal-command'
}

export function isTerminalAgentQuickCommand(
  command: TerminalQuickCommand
): command is TerminalAgentQuickCommand {
  return getTerminalQuickCommandAction(command) === 'agent-prompt'
}

export function supportsTerminalAgentQuickCommand(
  agent: unknown
): agent is TerminalAgentQuickCommand['agent'] {
  return isTuiAgent(agent) && TUI_AGENT_CONFIG[agent].promptInjectionMode !== 'stdin-after-start'
}

export function getTerminalQuickCommandBody(command: TerminalQuickCommand): string {
  return isTerminalAgentQuickCommand(command) ? command.prompt : command.command
}

export function isTerminalQuickCommandComplete(command: TerminalQuickCommand): boolean {
  return command.label.trim().length > 0 && getTerminalQuickCommandBody(command).trim().length > 0
}

export function normalizeTerminalQuickCommands(input: unknown): TerminalQuickCommand[] {
  if (!Array.isArray(input)) {
    return getDefaultTerminalQuickCommands()
  }

  const normalized: TerminalQuickCommand[] = []
  const seenIds = new Set<string>()

  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    const rawId = typeof record.id === 'string' ? record.id.trim() : ''
    if (REMOVED_PRESET_IDS.has(rawId)) {
      continue
    }
    const hasLabel = typeof record.label === 'string'
    const action: TerminalQuickCommandAction =
      record.action === 'agent-prompt' ? 'agent-prompt' : 'terminal-command'
    const hasCommand = typeof record.command === 'string'
    const hasPrompt = typeof record.prompt === 'string'
    // Why: settings saves on every edit; preserve incomplete rows so a newly
    // added command is not deleted before the user fills in the command text.
    if (!hasLabel && !hasCommand && !hasPrompt) {
      continue
    }
    const agent = supportsTerminalAgentQuickCommand(record.agent) ? record.agent : null
    if (action === 'agent-prompt' && agent === null) {
      continue
    }
    const label = hasLabel ? String(record.label).trim() : ''

    const idBase = rawId || `quick-command-${normalized.length + 1}`
    let id = idBase.slice(0, MAX_QUICK_COMMAND_ID_LENGTH)
    let suffix = 2
    while (seenIds.has(id)) {
      id = `${idBase.slice(0, MAX_QUICK_COMMAND_ID_LENGTH - 4)}-${suffix}`
      suffix += 1
    }
    seenIds.add(id)

    const base = {
      id,
      label: label.slice(0, MAX_QUICK_COMMAND_LABEL_LENGTH),
      scope: normalizeTerminalQuickCommandScope(record.scope)
    }

    if (action === 'agent-prompt') {
      if (agent === null) {
        continue
      }
      const agentId = agent
      normalized.push({
        ...base,
        action: 'agent-prompt',
        agent: agentId,
        prompt: (hasPrompt ? String(record.prompt).trimEnd() : '').slice(
          0,
          MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
        )
      })
    } else {
      const command = hasCommand ? String(record.command).trimEnd() : ''
      normalized.push({
        ...base,
        action: 'terminal-command',
        command: command.slice(0, MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH),
        appendEnter: record.appendEnter !== false,
        // Why: emitted only when true so legacy 6-key commands stay byte-identical
        // and pre-field sync clients keep accepting untouched lists.
        ...(record.runInActiveTab === true ? { runInActiveTab: true as const } : {})
      })
    }

    if (normalized.length >= MAX_QUICK_COMMANDS) {
      break
    }
  }

  return normalized
}

// Why: paired clients can edit settings concurrently. Applying one command at
// the host boundary preserves unrelated commands added by another client.
export function applyTerminalQuickCommandMutation(
  commands: readonly TerminalQuickCommand[],
  mutation: TerminalQuickCommandMutation
): TerminalQuickCommand[] {
  if (mutation.type === 'delete') {
    return commands.filter((command) => command.id !== mutation.id)
  }
  const existingIndex = commands.findIndex((command) => command.id === mutation.command.id)
  if (existingIndex === -1) {
    return [...commands, mutation.command]
  }
  return commands.map((command, index) => (index === existingIndex ? mutation.command : command))
}

export function buildTerminalQuickCommandInput(command: TerminalCommandQuickCommand): string {
  return command.appendEnter ? `${command.command}\r` : command.command
}

const LINE_BREAK_RE = /\r\n|\r|\n/

// Why: quick-command lines are independent shell commands; one shell command
// list prevents foreground programs from reading later lines as stdin.
export function flattenTerminalQuickCommand(
  command: TerminalCommandQuickCommand
): TerminalCommandQuickCommand {
  if (!LINE_BREAK_RE.test(command.command)) {
    return command
  }
  return {
    ...command,
    command: command.command
      .split(LINE_BREAK_RE)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('; ')
  }
}
