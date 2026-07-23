import { useAppStore } from '@/store'
import {
  SEND_TERMINAL_QUICK_COMMAND_EVENT,
  type SendTerminalQuickCommandDetail
} from '@/constants/terminal'
import { isTerminalAgentQuickCommand } from '../../../shared/terminal-quick-commands'
import {
  runQuickCommandInNewTab,
  type RunQuickCommandInNewTabArgs
} from './run-quick-command-in-new-tab'

/** The group's visible tab id when that tab is a terminal; null otherwise. */
function resolveActiveTerminalTabId(
  worktreeId: string,
  groupId: string | null | undefined
): string | null {
  const state = useAppStore.getState()
  const resolvedGroupId = groupId ?? state.activeGroupIdByWorktree[worktreeId] ?? null
  const group = resolvedGroupId
    ? state.groupsByWorktree[worktreeId]?.find((candidate) => candidate.id === resolvedGroupId)
    : null
  const activeTabId = group?.activeTabId ?? null
  if (!activeTabId) {
    return null
  }
  // Why: group.activeTabId can point at an editor or browser tab; only a
  // terminal tab can receive quick-command input.
  return state.tabsByWorktree[worktreeId]?.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : null
}

/**
 * Run a quick command honoring its per-command target. `runInActiveTab`
 * commands are sent to the group's visible terminal pane; everything else —
 * including `runInActiveTab` commands with no visible terminal to receive
 * them — spawns a fresh terminal tab via {@link runQuickCommandInNewTab}.
 */
export function runTerminalQuickCommand(
  args: RunQuickCommandInNewTabArgs
): { tabId: string } | null {
  const { command, worktreeId, groupId } = args
  if (!isTerminalAgentQuickCommand(command) && command.runInActiveTab) {
    const tabId = resolveActiveTerminalTabId(worktreeId, groupId)
    if (tabId) {
      const detail: SendTerminalQuickCommandDetail = { tabId, command }
      window.dispatchEvent(
        new CustomEvent<SendTerminalQuickCommandDetail>(SEND_TERMINAL_QUICK_COMMAND_EVENT, {
          detail
        })
      )
      if (detail.delivered) {
        if (groupId) {
          useAppStore.getState().setRecentQuickCommandForGroup(groupId, command.id)
        }
        return { tabId }
      }
    }
  }
  return runQuickCommandInNewTab(args)
}
