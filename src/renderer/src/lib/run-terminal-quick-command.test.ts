// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SEND_TERMINAL_QUICK_COMMAND_EVENT,
  type SendTerminalQuickCommandDetail
} from '@/constants/terminal'
import { runTerminalQuickCommand } from './run-terminal-quick-command'
import type { TerminalCommandQuickCommand } from '../../../shared/types'

type MockStoreState = {
  setRecentQuickCommandForGroup: ReturnType<typeof vi.fn>
  groupsByWorktree: Record<string, { id: string; activeTabId: string | null }[]>
  tabsByWorktree: Record<string, { id: string }[]>
  activeGroupIdByWorktree: Record<string, string>
}

const mocks = vi.hoisted(() => ({
  runQuickCommandInNewTab: vi.fn()
}))

let mockState: MockStoreState

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockState
  }
}))

vi.mock('./run-quick-command-in-new-tab', () => ({
  runQuickCommandInNewTab: mocks.runQuickCommandInNewTab
}))

function createStoreState(): MockStoreState {
  return {
    setRecentQuickCommandForGroup: vi.fn(),
    groupsByWorktree: { 'wt-1': [{ id: 'group-1', activeTabId: 'term-1' }] },
    tabsByWorktree: { 'wt-1': [{ id: 'term-1' }] },
    activeGroupIdByWorktree: { 'wt-1': 'group-1' }
  }
}

const activeTabCommand: TerminalCommandQuickCommand = {
  id: 'status',
  label: 'Status',
  action: 'terminal-command',
  command: 'git status',
  appendEnter: true,
  runInActiveTab: true,
  scope: { type: 'global' }
}

describe('runTerminalQuickCommand', () => {
  beforeEach(() => {
    mockState = createStoreState()
    mocks.runQuickCommandInNewTab.mockReset()
  })

  it('sends runInActiveTab commands to the visible terminal pane', () => {
    const received: SendTerminalQuickCommandDetail[] = []
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<SendTerminalQuickCommandDetail>).detail
      received.push(detail)
      detail.delivered = true
    }
    window.addEventListener(SEND_TERMINAL_QUICK_COMMAND_EVENT, listener)
    try {
      const result = runTerminalQuickCommand({
        command: activeTabCommand,
        worktreeId: 'wt-1',
        groupId: 'group-1'
      })

      expect(result).toEqual({ tabId: 'term-1' })
      expect(received).toEqual([{ tabId: 'term-1', command: activeTabCommand, delivered: true }])
      expect(mockState.setRecentQuickCommandForGroup).toHaveBeenCalledWith('group-1', 'status')
      expect(mocks.runQuickCommandInNewTab).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(SEND_TERMINAL_QUICK_COMMAND_EVENT, listener)
    }
  })

  it('falls back to a new tab when no pane consumes the event', () => {
    mocks.runQuickCommandInNewTab.mockReturnValue({ tabId: 'tab-new' })

    const result = runTerminalQuickCommand({
      command: activeTabCommand,
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })

    expect(result).toEqual({ tabId: 'tab-new' })
    expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledWith({
      command: activeTabCommand,
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })
  })

  it('falls back to a new tab when the group shows a non-terminal tab', () => {
    mockState.groupsByWorktree['wt-1'] = [{ id: 'group-1', activeTabId: 'editor-1' }]
    mocks.runQuickCommandInNewTab.mockReturnValue({ tabId: 'tab-new' })

    const result = runTerminalQuickCommand({
      command: activeTabCommand,
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })

    expect(result).toEqual({ tabId: 'tab-new' })
    expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledTimes(1)
  })

  it('opens a new tab for commands without runInActiveTab', () => {
    const listener = vi.fn()
    window.addEventListener(SEND_TERMINAL_QUICK_COMMAND_EVENT, listener)
    try {
      const { runInActiveTab: _target, ...newTabCommand } = activeTabCommand
      runTerminalQuickCommand({ command: newTabCommand, worktreeId: 'wt-1', groupId: 'group-1' })

      expect(listener).not.toHaveBeenCalled()
      expect(mocks.runQuickCommandInNewTab).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(SEND_TERMINAL_QUICK_COMMAND_EVENT, listener)
    }
  })
})
