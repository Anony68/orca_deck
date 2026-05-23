import type { Terminal } from '@xterm/xterm'
import { holdForegroundTerminalOutput } from '@/lib/pane-manager/pane-terminal-output-scheduler'

// Why: trusted wheel events arrive far enough apart that a 32-80ms debounce
// still interleaves TUI redraws; 140ms keeps a gesture together while keeping a
// lone wheel notch below normal human reaction latency.
const WHEEL_INPUT_BATCH_IDLE_MS = 140
const WHEEL_INPUT_BATCH_MAX_MS = 1500
const WHEEL_OUTPUT_HOLD_IDLE_MS = 96
const WHEEL_OUTPUT_HOLD_MAX_MS = 2000
const SGR_MOUSE_PREFIX = '\x1b[<'
const DEFAULT_MOUSE_PREFIX = '\x1b[M'

type TerminalWheelInputBatcherOptions = {
  terminal: Terminal
  sendInput: (data: string) => boolean
  canSend?: () => boolean
}

export type TerminalWheelInputBatcher = {
  enqueueIfWheelInput: (data: string) => boolean
  flush: () => void
  discard: () => void
}

function isWheelButtonCode(code: number): boolean {
  return (code & 64) === 64
}

function consumeSgrMouseReport(
  data: string,
  index: number
): { nextIndex: number; code: number } | null {
  if (!data.startsWith(SGR_MOUSE_PREFIX, index)) {
    return null
  }
  const finalIndex = data.indexOf('M', index + SGR_MOUSE_PREFIX.length)
  if (finalIndex === -1) {
    return null
  }
  const report = data.slice(index + SGR_MOUSE_PREFIX.length, finalIndex)
  const [codeText, colText, rowText] = report.split(';')
  if (!codeText || !colText || !rowText) {
    return null
  }
  const code = Number(codeText)
  const col = Number(colText)
  const row = Number(rowText)
  if (!Number.isInteger(code) || !Number.isInteger(col) || !Number.isInteger(row)) {
    return null
  }
  return { nextIndex: finalIndex + 1, code }
}

function consumeDefaultMouseReport(
  data: string,
  index: number
): { nextIndex: number; code: number } | null {
  if (!data.startsWith(DEFAULT_MOUSE_PREFIX, index) || index + 6 > data.length) {
    return null
  }
  return {
    nextIndex: index + 6,
    code: data.charCodeAt(index + 3) - 32
  }
}

export function isTerminalWheelInput(data: string): boolean {
  if (!data) {
    return false
  }

  let index = 0
  while (index < data.length) {
    const report = consumeSgrMouseReport(data, index) ?? consumeDefaultMouseReport(data, index)
    if (!report || !isWheelButtonCode(report.code)) {
      return false
    }
    index = report.nextIndex
  }
  return true
}

export function createTerminalWheelInputBatcher({
  terminal,
  sendInput,
  canSend = () => true
}: TerminalWheelInputBatcherOptions): TerminalWheelInputBatcher {
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  const pendingInput: string[] = []

  const clearTimers = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
  }

  const holdOutput = (): void => {
    holdForegroundTerminalOutput(terminal, {
      idleMs: WHEEL_OUTPUT_HOLD_IDLE_MS,
      maxMs: WHEEL_OUTPUT_HOLD_MAX_MS
    })
  }

  const flush = (): void => {
    clearTimers()
    if (pendingInput.length === 0) {
      return
    }
    const data = pendingInput.join('')
    pendingInput.length = 0
    if (!canSend()) {
      return
    }
    // Why: flushing a wheel batch usually causes a full-screen TUI repaint.
    // Keep the output side held briefly so xterm doesn't parse that repaint
    // in the middle of the next native wheel event.
    holdOutput()
    sendInput(data)
  }

  const scheduleFlush = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(flush, WHEEL_INPUT_BATCH_IDLE_MS)
    if (maxTimer === null) {
      maxTimer = setTimeout(flush, WHEEL_INPUT_BATCH_MAX_MS)
    }
  }

  return {
    enqueueIfWheelInput: (data: string): boolean => {
      if (!isTerminalWheelInput(data)) {
        return false
      }
      pendingInput.push(data)
      holdOutput()
      scheduleFlush()
      return true
    },
    flush,
    discard: () => {
      clearTimers()
      pendingInput.length = 0
    }
  }
}
