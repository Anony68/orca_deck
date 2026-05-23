import type { ForegroundTerminalOutputTarget } from './pane-terminal-foreground-render-settle'

export type TerminalOutputBeforeWrite = (data: string) => void

export type ForegroundOutputHoldOptions = {
  idleMs: number
  maxMs: number
}

type TerminalOutputTarget = ForegroundTerminalOutputTarget

type ForegroundHoldEntry = {
  terminal: TerminalOutputTarget
  chunks: string[]
  beforeWrite?: TerminalOutputBeforeWrite
  holdUntil: number
  idleTimer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
}

type WriteForegroundOutput = (
  terminal: TerminalOutputTarget,
  data: string,
  beforeWrite?: TerminalOutputBeforeWrite
) => void

const foregroundHoldByTerminal = new Map<TerminalOutputTarget, ForegroundHoldEntry>()

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function clearForegroundHoldTimers(entry: ForegroundHoldEntry): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }
  if (entry.maxTimer !== null) {
    clearTimeout(entry.maxTimer)
    entry.maxTimer = null
  }
}

function takeAllQueuedOutput(entry: ForegroundHoldEntry): string {
  const data = entry.chunks.join('')
  entry.chunks.length = 0
  return data
}

function flushForegroundHoldEntry(
  entry: ForegroundHoldEntry,
  writeForegroundOutput: WriteForegroundOutput
): void {
  clearForegroundHoldTimers(entry)
  foregroundHoldByTerminal.delete(entry.terminal)

  const data = takeAllQueuedOutput(entry)
  if (!data) {
    return
  }
  writeForegroundOutput(entry.terminal, data, entry.beforeWrite)
}

function scheduleForegroundHoldFlush(
  entry: ForegroundHoldEntry,
  writeForegroundOutput: WriteForegroundOutput
): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer)
  }

  const delayMs = Math.max(0, entry.holdUntil - nowMs())
  entry.idleTimer = setTimeout(
    () => flushForegroundHoldEntry(entry, writeForegroundOutput),
    delayMs
  )
}

function getActiveForegroundHoldEntry(
  terminal: TerminalOutputTarget,
  writeForegroundOutput: WriteForegroundOutput,
  atMs = nowMs()
): ForegroundHoldEntry | null {
  const entry = foregroundHoldByTerminal.get(terminal)
  if (!entry) {
    return null
  }
  if (atMs <= entry.holdUntil) {
    return entry
  }
  flushForegroundHoldEntry(entry, writeForegroundOutput)
  return null
}

export function queueForegroundOutputIfHeld(
  terminal: TerminalOutputTarget,
  data: string,
  beforeWrite: TerminalOutputBeforeWrite | undefined,
  writeForegroundOutput: WriteForegroundOutput
): boolean {
  const entry = getActiveForegroundHoldEntry(terminal, writeForegroundOutput)
  if (!entry) {
    return false
  }
  entry.beforeWrite = beforeWrite
  entry.chunks.push(data)
  scheduleForegroundHoldFlush(entry, writeForegroundOutput)
  return true
}

export function holdForegroundTerminalOutput(
  terminal: TerminalOutputTarget,
  options: ForegroundOutputHoldOptions,
  writeForegroundOutput?: WriteForegroundOutput
): void {
  const atMs = nowMs()
  const idleMs = Math.max(0, options.idleMs)
  const maxMs = Math.max(idleMs, options.maxMs)
  const existing = foregroundHoldByTerminal.get(terminal)
  const entry =
    existing && atMs <= existing.holdUntil
      ? existing
      : {
          terminal,
          chunks: [],
          holdUntil: atMs,
          idleTimer: null,
          maxTimer: null
        }

  if (existing && existing !== entry && writeForegroundOutput) {
    flushForegroundHoldEntry(existing, writeForegroundOutput)
  }

  entry.holdUntil = atMs + idleMs
  foregroundHoldByTerminal.set(terminal, entry)

  if (writeForegroundOutput) {
    scheduleForegroundHoldFlush(entry, writeForegroundOutput)
  }

  if (entry.maxTimer === null && writeForegroundOutput) {
    // Why: TUI wheel bursts should coalesce enough output for input to keep up,
    // but continuous scrolling must still repaint periodically.
    entry.maxTimer = setTimeout(() => flushForegroundHoldEntry(entry, writeForegroundOutput), maxMs)
  }
}

export function flushHeldForegroundOutput(
  terminal: TerminalOutputTarget,
  writeForegroundOutput: WriteForegroundOutput
): void {
  const heldEntry = foregroundHoldByTerminal.get(terminal)
  if (heldEntry) {
    flushForegroundHoldEntry(heldEntry, writeForegroundOutput)
  }
}

export function discardHeldForegroundOutput(terminal: TerminalOutputTarget): void {
  const heldEntry = foregroundHoldByTerminal.get(terminal)
  if (heldEntry) {
    clearForegroundHoldTimers(heldEntry)
    foregroundHoldByTerminal.delete(terminal)
  }
}
