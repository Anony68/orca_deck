import { describe, expect, it } from 'vitest'
import {
  applyTerminalQuickCommandMutation,
  buildTerminalQuickCommandInput,
  flattenTerminalQuickCommand,
  getTerminalQuickCommandAction,
  getTerminalQuickCommandBody,
  getDefaultTerminalQuickCommands,
  isTerminalQuickCommandComplete,
  MAX_QUICK_COMMANDS,
  normalizeTerminalQuickCommands,
  seedDefaultTerminalQuickCommands,
  supportsTerminalAgentQuickCommand,
  terminalQuickCommandMatchesRepo
} from './terminal-quick-commands'
import { parseNormalizedTerminalQuickCommands } from './terminal-quick-command-sync-parse'

const CLAUDE_PRESET_IDS = [
  'claude-preset-run',
  'claude-preset-continue',
  'claude-preset-resume',
  'claude-preset-skip-permissions',
  'claude-preset-update'
]

describe('terminal quick commands', () => {
  it('returns the Claude presets when persisted settings are missing', () => {
    const defaults = getDefaultTerminalQuickCommands()
    expect(defaults.map((command) => command.id)).toEqual(CLAUDE_PRESET_IDS)
    expect(normalizeTerminalQuickCommands(undefined)).toEqual(defaults)
    // Why: presets must survive normalization byte-for-byte or full-list sync payloads get rejected.
    expect(parseNormalizedTerminalQuickCommands(defaults)).toEqual(defaults)
  })

  it('keeps an intentionally empty command list', () => {
    expect(normalizeTerminalQuickCommands([])).toEqual([])
  })

  it('seeds missing Claude presets after existing commands', () => {
    const mine = {
      id: 'mine',
      label: 'Mine',
      action: 'terminal-command' as const,
      command: 'pwd',
      appendEnter: true,
      scope: { type: 'global' as const }
    }
    const seeded = seedDefaultTerminalQuickCommands([mine])
    expect(seeded.map((command) => command.id)).toEqual(['mine', ...CLAUDE_PRESET_IDS])
  })

  it('does not duplicate presets already present when seeding', () => {
    const existing = getDefaultTerminalQuickCommands().slice(0, 2)
    const seeded = seedDefaultTerminalQuickCommands(existing)
    expect(seeded.map((command) => command.id)).toEqual(CLAUDE_PRESET_IDS)
  })

  it('stops seeding at the quick-command cap', () => {
    const full = Array.from({ length: MAX_QUICK_COMMANDS - 1 }, (_, index) => ({
      id: `user-${index}`,
      label: `User ${index}`,
      action: 'terminal-command' as const,
      command: 'pwd',
      appendEnter: true,
      scope: { type: 'global' as const }
    }))
    const seeded = seedDefaultTerminalQuickCommands(full)
    expect(seeded).toHaveLength(MAX_QUICK_COMMANDS)
    expect(seeded.at(-1)?.id).toBe(CLAUDE_PRESET_IDS[0])
  })

  it('removes quick commands from the abandoned preset rollout', () => {
    expect(
      normalizeTerminalQuickCommands([
        {
          id: 'default-pwd',
          label: 'Print Working Directory',
          command: 'pwd',
          appendEnter: true
        },
        {
          id: 'default-git-status',
          label: 'Git Status',
          command: 'git status',
          appendEnter: true
        }
      ])
    ).toEqual([])
  })

  it('drops malformed entries and normalizes valid commands and drafts', () => {
    expect(
      normalizeTerminalQuickCommands([
        null,
        { id: 'status', label: '  Status  ', command: 'git status\n', appendEnter: false },
        { id: 'empty-command', label: 'Empty', command: '   ' },
        { id: 'status', label: 'Duplicate', command: 'pwd' },
        { label: 'No ID', command: 'date' }
      ])
    ).toEqual([
      {
        id: 'status',
        label: 'Status',
        action: 'terminal-command',
        command: 'git status',
        appendEnter: false,
        scope: { type: 'global' }
      },
      {
        id: 'empty-command',
        label: 'Empty',
        action: 'terminal-command',
        command: '',
        appendEnter: true,
        scope: { type: 'global' }
      },
      {
        id: 'status-2',
        label: 'Duplicate',
        action: 'terminal-command',
        command: 'pwd',
        appendEnter: true,
        scope: { type: 'global' }
      },
      {
        id: 'quick-command-4',
        label: 'No ID',
        action: 'terminal-command',
        command: 'date',
        appendEnter: true,
        scope: { type: 'global' }
      }
    ])
  })

  it('normalizes repository scoped commands and falls back to global for invalid scopes', () => {
    expect(
      normalizeTerminalQuickCommands([
        {
          id: 'repo-dev',
          label: 'Dev',
          command: 'pnpm dev',
          scope: { type: 'repo', repoId: ' repo-1 ' }
        },
        {
          id: 'bad-repo',
          label: 'Bad',
          command: 'echo bad',
          scope: { type: 'repo', repoId: '   ' }
        }
      ])
    ).toEqual([
      {
        id: 'repo-dev',
        label: 'Dev',
        action: 'terminal-command',
        command: 'pnpm dev',
        appendEnter: true,
        scope: { type: 'repo', repoId: 'repo-1' }
      },
      {
        id: 'bad-repo',
        label: 'Bad',
        action: 'terminal-command',
        command: 'echo bad',
        appendEnter: true,
        scope: { type: 'global' }
      }
    ])
  })

  it('normalizes agent prompt commands without storing generated shell text', () => {
    expect(
      normalizeTerminalQuickCommands([
        {
          id: 'agent-review',
          label: 'Review',
          action: 'agent-prompt',
          agent: 'codex',
          prompt: '  Review this diff\n',
          command: "codex 'old workaround'"
        },
        {
          id: 'unknown-agent',
          label: 'Unknown',
          action: 'agent-prompt',
          agent: 'not-real',
          prompt: 'Do work'
        },
        {
          id: 'post-start-agent',
          label: 'Aider',
          action: 'agent-prompt',
          agent: 'aider',
          prompt: 'Do work'
        }
      ])
    ).toEqual([
      {
        id: 'agent-review',
        label: 'Review',
        action: 'agent-prompt',
        agent: 'codex',
        prompt: '  Review this diff',
        scope: { type: 'global' }
      }
    ])
  })

  it('keeps larger reusable agent prompts while bounding shell commands separately', () => {
    const largePrompt = 'Review this diff.\n'.repeat(320)
    const overLimitPrompt = 'x'.repeat(6001)
    const overLimitCommand = 'y'.repeat(4001)

    expect(
      normalizeTerminalQuickCommands([
        {
          id: 'large-review',
          label: 'Review',
          action: 'agent-prompt',
          agent: 'codex',
          prompt: largePrompt
        },
        {
          id: 'over-limit-review',
          label: 'Review with cap',
          action: 'agent-prompt',
          agent: 'codex',
          prompt: overLimitPrompt
        },
        {
          id: 'over-limit-command',
          label: 'Run long command',
          command: overLimitCommand
        }
      ])
    ).toEqual([
      {
        id: 'large-review',
        label: 'Review',
        action: 'agent-prompt',
        agent: 'codex',
        prompt: largePrompt.trimEnd(),
        scope: { type: 'global' }
      },
      {
        id: 'over-limit-review',
        label: 'Review with cap',
        action: 'agent-prompt',
        agent: 'codex',
        prompt: 'x'.repeat(6000),
        scope: { type: 'global' }
      },
      {
        id: 'over-limit-command',
        label: 'Run long command',
        action: 'terminal-command',
        command: 'y'.repeat(4000),
        appendEnter: true,
        scope: { type: 'global' }
      }
    ])
  })

  it('accepts only complete canonical command lists at protocol boundaries', () => {
    const canonical = normalizeTerminalQuickCommands([
      { id: 'status', label: 'Status', command: 'git status', appendEnter: true }
    ])

    expect(parseNormalizedTerminalQuickCommands(canonical)).toEqual(canonical)
    expect(parseNormalizedTerminalQuickCommands([{ ...canonical[0], command: 42 }])).toBeNull()
    expect(
      parseNormalizedTerminalQuickCommands([...canonical, ...canonical.slice(0, 1)])
    ).toBeNull()
  })

  it('keeps runInActiveTab only when explicitly true', () => {
    const normalized = normalizeTerminalQuickCommands([
      { id: 'here', label: 'Here', command: 'pwd', appendEnter: true, runInActiveTab: true },
      { id: 'new-tab', label: 'New tab', command: 'pwd', appendEnter: true, runInActiveTab: false },
      { id: 'junk', label: 'Junk', command: 'pwd', appendEnter: true, runInActiveTab: 'yes' }
    ])

    expect(normalized[0]).toMatchObject({ id: 'here', runInActiveTab: true })
    // Why: absent-or-true keeps legacy 6-key commands byte-identical for
    // full-list sync clients built before the field existed.
    expect(Object.hasOwn(normalized[1]!, 'runInActiveTab')).toBe(false)
    expect(Object.hasOwn(normalized[2]!, 'runInActiveTab')).toBe(false)
  })

  it('round-trips runInActiveTab commands and rejects explicit false at protocol boundaries', () => {
    const canonical = normalizeTerminalQuickCommands([
      { id: 'here', label: 'Here', command: 'pwd', appendEnter: true, runInActiveTab: true }
    ])

    expect(parseNormalizedTerminalQuickCommands(canonical)).toEqual(canonical)
    expect(
      parseNormalizedTerminalQuickCommands([{ ...canonical[0], runInActiveTab: false }])
    ).toBeNull()
  })

  it('applies targeted mutations without replacing unrelated commands', () => {
    const [first, second] = normalizeTerminalQuickCommands([
      { id: 'first', label: 'First', command: 'echo first', appendEnter: true },
      { id: 'second', label: 'Second', command: 'echo second', appendEnter: true }
    ])
    const edited = { ...first!, label: 'Edited' }

    expect(
      applyTerminalQuickCommandMutation([first!, second!], {
        type: 'upsert',
        command: edited
      })
    ).toEqual([edited, second])
    expect(
      applyTerminalQuickCommandMutation([first!, second!], { type: 'delete', id: first!.id })
    ).toEqual([second])
  })

  it('matches global commands everywhere and repo commands only in their repo', () => {
    expect(
      terminalQuickCommandMatchesRepo(
        {
          id: 'global',
          label: 'Global',
          command: 'date',
          appendEnter: true,
          scope: { type: 'global' }
        },
        null
      )
    ).toBe(true)
    expect(
      terminalQuickCommandMatchesRepo(
        {
          id: 'repo',
          label: 'Repo',
          command: 'pnpm dev',
          appendEnter: true,
          scope: { type: 'repo', repoId: 'repo-1' }
        },
        'repo-1'
      )
    ).toBe(true)
    expect(
      terminalQuickCommandMatchesRepo(
        {
          id: 'repo',
          label: 'Repo',
          command: 'pnpm dev',
          appendEnter: true,
          scope: { type: 'repo', repoId: 'repo-1' }
        },
        'repo-2'
      )
    ).toBe(false)
  })

  it('formats terminal input without assuming shell semantics', () => {
    expect(
      buildTerminalQuickCommandInput({
        id: 'status',
        label: 'Status',
        command: 'git status',
        appendEnter: true
      })
    ).toBe('git status\r')
    expect(
      buildTerminalQuickCommandInput({
        id: 'status',
        label: 'Status',
        command: 'git status',
        appendEnter: false
      })
    ).toBe('git status')
  })

  it('classifies quick command actions and body text', () => {
    const terminal = {
      id: 'status',
      label: 'Status',
      command: 'git status',
      appendEnter: true
    }
    const agent = {
      id: 'agent',
      label: 'Agent',
      action: 'agent-prompt' as const,
      agent: 'claude' as const,
      prompt: 'Fix the tests'
    }

    expect(getTerminalQuickCommandAction(terminal)).toBe('terminal-command')
    expect(getTerminalQuickCommandBody(terminal)).toBe('git status')
    expect(isTerminalQuickCommandComplete(terminal)).toBe(true)
    expect(getTerminalQuickCommandAction(agent)).toBe('agent-prompt')
    expect(getTerminalQuickCommandBody(agent)).toBe('Fix the tests')
    expect(isTerminalQuickCommandComplete(agent)).toBe(true)
  })

  it('only allows agent prompt quick commands for launch-time prompt agents', () => {
    expect(supportsTerminalAgentQuickCommand('claude')).toBe(true)
    expect(supportsTerminalAgentQuickCommand('gemini')).toBe(true)
    expect(supportsTerminalAgentQuickCommand('aider')).toBe(false)
    expect(supportsTerminalAgentQuickCommand('not-real')).toBe(false)
  })
})

describe('flattenTerminalQuickCommand', () => {
  it('returns the same object when there are no line breaks', () => {
    const command = {
      id: 'test',
      label: 'Test',
      command: 'git status',
      appendEnter: true
    } as const
    expect(flattenTerminalQuickCommand(command)).toBe(command)
  })

  it('replaces newlines with semicolons and spaces', () => {
    const result = flattenTerminalQuickCommand({
      id: 'test',
      label: 'Test',
      command: 'cd packages\nbun run build\ncd ..',
      appendEnter: true
    })
    expect(result.command).toBe('cd packages; bun run build; cd ..')
  })

  it('collapses consecutive newlines into a single separator', () => {
    const result = flattenTerminalQuickCommand({
      id: 'test',
      label: 'Test',
      command: 'echo one\n\n\necho two',
      appendEnter: true
    })
    expect(result.command).toBe('echo one; echo two')
  })

  it('handles Windows-style CRLF endings', () => {
    const result = flattenTerminalQuickCommand({
      id: 'test',
      label: 'Test',
      command: 'echo one\r\necho two',
      appendEnter: true
    })
    expect(result.command).toBe('echo one; echo two')
  })

  it('drops empty edge lines without leaving dangling separators', () => {
    const result = flattenTerminalQuickCommand({
      id: 'test',
      label: 'Test',
      command: '\n  echo one  \n\n  echo two\n',
      appendEnter: true
    })
    expect(result.command).toBe('echo one; echo two')
  })
})
