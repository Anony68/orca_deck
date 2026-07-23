import { Notification, ipcMain, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, normalize } from 'node:path'
import beepSoundPath from '../../../resources/notification-sounds/beep.mp3?asset'
import blipSoundPath from '../../../resources/notification-sounds/blip.mp3?asset'
import blopSoundPath from '../../../resources/notification-sounds/blop.mp3?asset'
import bongSoundPath from '../../../resources/notification-sounds/bong.mp3?asset'
import clackSoundPath from '../../../resources/notification-sounds/clack.mp3?asset'
import dingSoundPath from '../../../resources/notification-sounds/ding.mp3?asset'
import sonarSoundPath from '../../../resources/notification-sounds/sonar.mp3?asset'
import thumpSoundPath from '../../../resources/notification-sounds/thump.mp3?asset'
import twoToneSoundPath from '../../../resources/notification-sounds/two-tone.mp3?asset'
import type { Store } from '../persistence'
import type {
  NotificationDeliveryProbeResult,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationDismissResult,
  NotificationPermissionStatusResult,
  NotificationSettings,
  NotificationSoundDataResult
} from '../../shared/types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import {
  createNotificationDispatcher,
  getEffectiveNotificationSoundId,
  logNativeNotificationFailure
} from './notification-dispatch'
import { activeNotifications } from './notification-retention'
import {
  hasTriggeredPermissionDialogThisSession,
  probeNotificationDelivery,
  resetNotificationDeliveryProbeSession
} from './notification-delivery-probe'
import {
  getNotificationDeliveryOutcome,
  recordNotificationDeliveryOutcome,
  resetNotificationDeliveryEvidence
} from './notification-delivery-evidence'

const MAX_NOTIFICATION_SOUND_BYTES = 10 * 1024 * 1024
const MACOS_PACKAGED_BUNDLE_ID = 'com.stablyai.orca'
const MACOS_NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
const NOTIFICATION_SOUND_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac']
])
const BUILT_IN_NOTIFICATION_SOUNDS: ReadonlyMap<string, string> = new Map([
  ['two-tone', twoToneSoundPath],
  ['bong', bongSoundPath],
  ['thump', thumpSoundPath],
  ['blip', blipSoundPath],
  ['sonar', sonarSoundPath],
  ['blop', blopSoundPath],
  ['ding', dingSoundPath],
  ['clack', clackSoundPath],
  ['beep', beepSoundPath]
])
function getMacNotificationSettingsUrl(): string {
  const bundleId = process.env.ORCA_DEV_MACOS_BUNDLE_ID ?? MACOS_PACKAGED_BUNDLE_ID
  return `${MACOS_NOTIFICATION_SETTINGS_URL}?id=${encodeURIComponent(bundleId)}`
}

function openNotificationSystemSettings(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal(getMacNotificationSettingsUrl())
  } else if (process.platform === 'win32') {
    void shell.openExternal('ms-settings:notifications')
  }
}

function getSelectedNotificationSoundPath(settings: NotificationSettings): {
  path: string | null
  reason?: 'missing-path' | 'invalid-path' | 'unsupported-type'
} {
  const customSoundId = getEffectiveNotificationSoundId(settings)
  if (customSoundId === 'system') {
    return { path: null, reason: 'missing-path' }
  }
  if (customSoundId !== 'custom') {
    const builtInPath = BUILT_IN_NOTIFICATION_SOUNDS.get(customSoundId)
    return builtInPath ? { path: builtInPath } : { path: null, reason: 'missing-path' }
  }
  if (!settings.customSoundPath) {
    return { path: null, reason: 'missing-path' }
  }
  const normalizedPath = normalize(settings.customSoundPath)
  if (!isAbsolute(normalizedPath)) {
    return { path: null, reason: 'invalid-path' }
  }
  if (!NOTIFICATION_SOUND_MIME_BY_EXTENSION.has(extname(normalizedPath).toLowerCase())) {
    return { path: null, reason: 'unsupported-type' }
  }
  return { path: normalizedPath }
}

export function registerNotificationHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  const dispatcher = createNotificationDispatcher(store, runtime)
  // Why: handler registration marks a fresh session; permission evidence from a previous one must not leak in.
  resetNotificationDeliveryEvidence()
  resetNotificationDeliveryProbeSession()

  ipcMain.removeHandler('notifications:openSystemSettings')
  ipcMain.removeHandler('notifications:getPermissionStatus')
  ipcMain.removeHandler('notifications:probeDelivery')
  ipcMain.handle('notifications:openSystemSettings', (): void => {
    openNotificationSystemSettings()
  })

  // Why: Electron's main process can't read macOS auth status; expose only what we can observe (platform support + whether we've prompted).
  const getPermissionStatus = (): NotificationPermissionStatusResult => ({
    supported: Notification.isSupported(),
    platform: process.platform,
    requested: store.getUI().notificationPermissionRequested === true
  })

  ipcMain.handle('notifications:getPermissionStatus', getPermissionStatus)
  ipcMain.handle(
    'notifications:probeDelivery',
    async (_event, args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> => {
      // Why: macOS-only — Windows/Linux have no first-use permission dialog, so the onboarding card never renders there.
      if (process.platform !== 'darwin' || !Notification.isSupported()) {
        return { state: 'unsupported', authoritative: false }
      }
      // Why: probes surface the macOS permission dialog, so mark startup registration done to avoid a second prompt later.
      if (store.getUI().notificationPermissionRequested !== true) {
        store.updateUI({ notificationPermissionRequested: true })
      }
      // Preferred source: the bundled helper reads real auth silently, so polling tracks System Settings changes without banners.
      const authorization = await readNotificationAuthorizationStatus()
      if (authorization === 'authorized') {
        recordNotificationDeliveryOutcome('delivered')
        return { state: 'delivered', authoritative: true }
      }
      if (authorization === 'denied') {
        recordNotificationDeliveryOutcome('failed')
        return { state: 'blocked', authoritative: true }
      }
      if (authorization === 'not-determined') {
        // Why: the dialog only appears once something asks; fire one probe per session to trigger it, then report pending.
        if (!hasTriggeredPermissionDialogThisSession()) {
          void probeNotificationDelivery()
        }
        return { state: 'awaiting-decision', authoritative: true }
      }
      // Helper unavailable or 'unknown': fall back to scheduling-based probes with session caching to avoid repeated banners.
      const observedOutcome = getNotificationDeliveryOutcome()
      if (!args?.force && observedOutcome !== null) {
        return {
          state: observedOutcome === 'delivered' ? 'delivered' : 'blocked',
          authoritative: false
        }
      }
      return probeNotificationDelivery()
    }
  )

  ipcMain.removeHandler('notifications:dismiss')
  ipcMain.handle('notifications:dismiss', (_event, ids: string[]): NotificationDismissResult => {
    return { dismissed: dispatcher.dismissNotificationsById(ids) }
  })

  ipcMain.removeHandler('notifications:dispatch')
  ipcMain.handle(
    'notifications:dispatch',
    (
      _event,
      args: NotificationDispatchRequest
    ): NotificationDispatchResult | Promise<NotificationDispatchResult> =>
      dispatcher.dispatchNotification(args)
  )

  // Why: return the path so the preload's path-keyed cache skips the 10MB IPC round-trip on repeat dispatches.
  ipcMain.removeHandler('notifications:resolveSoundPath')
  ipcMain.handle(
    'notifications:resolveSoundPath',
    ():
      | { ok: true; path: string }
      | { ok: false; reason: 'missing-path' | 'invalid-path' | 'unsupported-type' } => {
      const selectedSound = getSelectedNotificationSoundPath(store.getSettings().notifications)
      if (!selectedSound.path) {
        return { ok: false, reason: selectedSound.reason ?? 'missing-path' }
      }
      const normalizedPath = normalize(selectedSound.path)
      if (!NOTIFICATION_SOUND_MIME_BY_EXTENSION.has(extname(normalizedPath).toLowerCase())) {
        return { ok: false, reason: 'unsupported-type' }
      }
      return { ok: true, path: normalizedPath }
    }
  )

  ipcMain.removeHandler('notifications:loadSound')
  ipcMain.handle('notifications:loadSound', async (): Promise<NotificationSoundDataResult> => {
    const selectedSound = getSelectedNotificationSoundPath(store.getSettings().notifications)
    if (!selectedSound.path) {
      return { ok: false, reason: selectedSound.reason ?? 'missing-path' }
    }

    const normalizedPath = normalize(selectedSound.path)

    const mimeType = NOTIFICATION_SOUND_MIME_BY_EXTENSION.get(extname(normalizedPath).toLowerCase())
    if (!mimeType) {
      return { ok: false, reason: 'unsupported-type' }
    }

    try {
      const fileStat = await stat(normalizedPath)
      if (!fileStat.isFile()) {
        return { ok: false, reason: 'invalid-path' }
      }
      if (fileStat.size > MAX_NOTIFICATION_SOUND_BYTES) {
        return { ok: false, reason: 'too-large' }
      }

      const data = await readFile(normalizedPath)
      return { ok: true, data: new Uint8Array(data), mimeType, path: normalizedPath }
    } catch {
      return { ok: false, reason: 'read-failed' }
    }
  })
}

/**
 * On first launch (macOS permission 'not-determined'), show a welcome notification to trigger the system prompt.
 *
 * Why: macOS requires at least one notification attempt before it will prompt to allow/deny.
 */
export function triggerStartupNotificationRegistration(store: Store): void {
  if (process.platform !== 'darwin' || !Notification.isSupported()) {
    return
  }
  // Why: fire once per install, not on every launch where status stays not-determined (e.g. user dismisses the dialog).
  const ui = store.getUI()
  if (ui.notificationPermissionRequested) {
    return
  }
  store.updateUI({ notificationPermissionRequested: true })

  const notification = new Notification({
    title: 'Orca is ready to notify you',
    body: 'Allow notifications so Orca can alert you when agents finish or terminals need attention.'
  })

  // Why: prevent GC from collecting the notification and its click handler while it's still visible.
  activeNotifications.add(notification)

  let handled = false
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  function clearStartupTimers(): void {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
  }

  function cleanup(): void {
    if (handled) {
      return
    }
    handled = true
    clearStartupTimers()
    activeNotifications.delete(notification)
    notification.removeListener('click', onClick)
    notification.removeListener('show', onShow)
    notification.removeListener('failed', onFailed)
    notification.close()
  }

  // Why: the body reads like an actionable "Allow notifications…" prompt, so clicking opens macOS Notification Settings.
  function onClick(): void {
    cleanup()
    openNotificationSystemSettings()
  }

  function onShow(): void {
    // Why: close after a delay so the banner doesn't linger; the macOS permission sheet is separate and unaffected.
    closeTimer = setTimeout(cleanup, 8000)
    if (typeof closeTimer.unref === 'function') {
      closeTimer.unref()
    }
  }

  function onFailed(_event: unknown, error?: string): void {
    // Why: Electron 42 requires code-signed macOS apps for UNNotification delivery; unsigned builds fail here.
    logNativeNotificationFailure('startup registration', error)
    recordNotificationDeliveryOutcome('failed')
    cleanup()
  }

  notification.on('click', onClick)
  notification.on('show', onShow)
  notification.on('failed', onFailed)

  // Fallback in case macOS doesn't fire the 'show' event (e.g. user denies).
  fallbackTimer = setTimeout(cleanup, 10_000)
  if (typeof fallbackTimer.unref === 'function') {
    fallbackTimer.unref()
  }

  notification.show()
}
