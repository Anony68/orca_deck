import { app, BrowserWindow, Notification } from 'electron'
import type { Store } from '../persistence'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import { parsePaneKey } from '../../shared/stable-pane-id'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from './notification-options'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import { setTrayAttention } from '../tray/system-tray'
import { isMainWindowVisible } from '../window/main-window-visibility'
import { recordNotificationDeliveryOutcome } from './notification-delivery-evidence'
import { reserveNotificationCooldown } from './notification-cooldown'
import {
  activeNotificationsById,
  retainNotificationUntilRelease,
  waitForNotificationDisplay
} from './notification-retention'

export function getEffectiveNotificationSoundId(
  settings: NotificationSettings
): NotificationSettings['customSoundId'] {
  return settings.customSoundId ?? (settings.customSoundPath ? 'custom' : 'system')
}

export function logNativeNotificationFailure(context: string, error?: string): void {
  console.warn(
    `[notifications] ${context} notification failed to show${error ? `: ${error}` : '.'}`
  )
}

// Why: reminders dedupe on their own occurrence id — a same-worktree agent-finish
// burst must not swallow a due reminder (or the reverse).
function notificationDedupeKey(args: NotificationDispatchRequest): string {
  if (args.source === 'reminder') {
    return args.notificationId ?? 'reminder'
  }
  return args.worktreeId ?? args.worktreeLabel ?? 'global'
}

function isNotificationSourceDisabled(
  args: NotificationDispatchRequest,
  settings: NotificationSettings
): boolean {
  return (
    (args.source === 'agent-task-complete' && !settings.agentTaskComplete) ||
    (args.source === 'terminal-bell' && !settings.terminalBell) ||
    (args.source === 'reminder' && !settings.reminders)
  )
}

export type NotificationDispatcher = (
  args: NotificationDispatchRequest
) => NotificationDispatchResult | Promise<NotificationDispatchResult>

export type NotificationDispatcherHandle = {
  dispatchNotification: NotificationDispatcher
  dismissNotificationsById: (ids: string[]) => number
}

// Why: cooldown/dedupe state must be shared between the renderer IPC path and
// main-side callers (ReminderService); the register step creates one instance
// and later services fetch it lazily.
let activeDispatcher: NotificationDispatcherHandle | null = null

export function getActiveNotificationDispatcher(): NotificationDispatcherHandle | null {
  return activeDispatcher
}

export function createNotificationDispatcher(
  store: Store,
  runtime?: OrcaRuntimeService
): NotificationDispatcherHandle {
  const recentDesktopNotifications = new Map<string, number>()
  const recentMobileNotifications = new Map<string, number>()

  function dispatchNotification(
    args: NotificationDispatchRequest
  ): NotificationDispatchResult | Promise<NotificationDispatchResult> {
    // Why: light the tray attention dot before the cooldown/focus/enabled gates so they can't hold it back (clears on window show/restore; see index.ts).
    if (
      args.source === 'agent-task-complete' ||
      args.source === 'terminal-bell' ||
      args.source === 'reminder'
    ) {
      const activeWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
      if (!isMainWindowVisible(activeWindow)) {
        setTrayAttention(true)
      }
    }

    const settings = store.getSettings().notifications
    if (!settings.enabled) {
      return { delivered: false, reason: 'disabled' }
    }

    if (isNotificationSourceDisabled(args, settings)) {
      return { delivered: false, reason: 'source-disabled' }
    }

    const notificationOptions = buildNotificationOptions(args)

    // Why: desktop focus only means this computer sees the worktree; the paired phone may still need the alert.
    if (runtime && args.source !== 'test') {
      const dedupeKey = notificationDedupeKey(args)
      if (reserveNotificationCooldown(recentMobileNotifications, dedupeKey, Date.now())) {
        runtime.dispatchMobileNotification({
          type: 'notification',
          source: args.source,
          title: notificationOptions.title,
          body: notificationOptions.body,
          worktreeId: args.worktreeId,
          ...(args.notificationId ? { notificationId: args.notificationId } : {})
        })
      }
    }

    const browserWindow =
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
    if (
      settings.suppressWhenFocused &&
      args.isActiveWorktree &&
      browserWindow &&
      browserWindow.isFocused()
    ) {
      return { delivered: false, reason: 'suppressed-focus' }
    }

    // Why: the Settings test button is an explicit, often-repeated user action, so it bypasses burst dedupe.
    if (args.source !== 'test') {
      // Dedupe by worktree, not source — agent-finish and terminal-bell often fire in one chunk; surface only the first.
      const dedupeKey = notificationDedupeKey(args)
      if (!reserveNotificationCooldown(recentDesktopNotifications, dedupeKey, Date.now())) {
        return { delivered: false, reason: 'cooldown' }
      }
    }

    if (!Notification.isSupported()) {
      return { delivered: false, reason: 'not-supported' }
    }

    function deliverNativeNotification():
      | NotificationDispatchResult
      | Promise<NotificationDispatchResult> {
      if (getEffectiveNotificationSoundId(settings) !== 'system') {
        notificationOptions.silent = true
      } else if (process.platform === 'darwin') {
        // Why: macOS treats an unset sound as silent, so request Electron's default when using the OS sound.
        notificationOptions.sound = 'default'
      }
      const notification = new Notification(notificationOptions)
      if (args.notificationId) {
        const previous = activeNotificationsById.get(args.notificationId)
        if (previous) {
          previous.notification.close()
          previous.release()
        }
      }

      // Why: prevent GC from collecting the notification and its click handler while it's still visible.
      let clickHandler: (() => void) | null = null
      let failedHandler: ((_event: unknown, error?: string) => void) | null = null
      const entryForId: { notification: Notification; release: () => void } | null =
        args.notificationId ? { notification, release: () => {} } : null
      const release = retainNotificationUntilRelease(notification, () => {
        if (clickHandler) {
          notification.removeListener('click', clickHandler)
          clickHandler = null
        }
        if (failedHandler) {
          notification.removeListener('failed', failedHandler)
          failedHandler = null
        }
        if (
          args.notificationId &&
          activeNotificationsById.get(args.notificationId) === entryForId
        ) {
          activeNotificationsById.delete(args.notificationId)
        }
      })
      if (entryForId && args.notificationId) {
        entryForId.release = release
        activeNotificationsById.set(args.notificationId, entryForId)
      }

      failedHandler = (_event, error) => {
        // Why: Electron 42's macOS backend reports unsigned/delivery failures here; release now, not after the fallback timer.
        logNativeNotificationFailure(args.source, error)
        // Why: feeds the permission card's evidence.
        recordNotificationDeliveryOutcome('failed')
        release()
      }
      notification.on('failed', failedHandler)

      // Why: worktreeId is formatted "repoId::worktreePath"; without the separator we can't extract a repoId, so skip the click-to-navigate binding.
      if (args.worktreeId && args.worktreeId.includes('::')) {
        const repoId = getRepoIdFromWorktreeId(args.worktreeId)
        clickHandler = () => {
          release()
          const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
          if (!win) {
            return
          }
          if (process.platform === 'darwin') {
            app.focus({ steal: true })
          }
          if (win.isMinimized()) {
            win.restore()
          }
          win.focus()
          win.webContents.send('ui:activateWorktree', {
            repoId,
            worktreeId: args.worktreeId
          })
          // Why: focusTerminal targets the pane by stable leafId so split-pane notifications land on the exact pane.
          const paneTarget = args.paneKey ? parsePaneKey(args.paneKey) : null
          if (paneTarget) {
            win.webContents.send('ui:focusTerminal', {
              tabId: paneTarget.tabId,
              worktreeId: args.worktreeId,
              leafId: paneTarget.leafId,
              ackPaneKeyOnSuccess: args.paneKey,
              flashFocusedPane: true,
              scrollToBottomIfOutputSinceLastView: true
            })
          }
        }
        notification.on('click', clickHandler)
      }

      const displayConfirmation = args.requireDisplayConfirmation
        ? waitForNotificationDisplay(notification)
        : null
      notification.show()

      if (displayConfirmation) {
        return displayConfirmation.then((displayed) => {
          if (!displayed) {
            release()
            return { delivered: false, reason: 'not-displayed' }
          }
          recordNotificationDeliveryOutcome('delivered')
          return { delivered: true }
        })
      }

      return { delivered: true }
    }

    if (process.platform !== 'darwin') {
      return deliverNativeNotification()
    }
    // Why: macOS silently swallows notifications while permission is denied/undecided (verified macOS 26); skip so the renderer can show a fallback.
    return readNotificationAuthorizationStatus().then((authorization) => {
      if (authorization === 'denied' || authorization === 'not-determined') {
        recordNotificationDeliveryOutcome('failed')
        return { delivered: false, reason: 'blocked-by-system' }
      }
      return deliverNativeNotification()
    })
  }

  function dismissNotificationsById(ids: string[]): number {
    const uniqueIds = Array.from(
      new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
    )
    let dismissed = 0
    for (const id of uniqueIds) {
      const entry = activeNotificationsById.get(id)
      if (entry) {
        entry.notification.close()
        entry.release()
        dismissed += 1
      }
      runtime?.dismissMobileNotification(id)
    }
    return dismissed
  }

  const handle: NotificationDispatcherHandle = { dispatchNotification, dismissNotificationsById }
  activeDispatcher = handle
  return handle
}
