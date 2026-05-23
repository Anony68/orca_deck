import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTerminalWheelInputBatcher,
  isTerminalWheelInput
} from './terminal-wheel-input-batcher'
import { holdForegroundTerminalOutput } from '@/lib/pane-manager/pane-terminal-output-scheduler'

vi.mock('@/lib/pane-manager/pane-terminal-output-scheduler', () => ({
  holdForegroundTerminalOutput: vi.fn()
}))

describe('isTerminalWheelInput', () => {
  it('recognizes SGR wheel reports', () => {
    expect(isTerminalWheelInput('\x1b[<64;10;20M')).toBe(true)
    expect(isTerminalWheelInput('\x1b[<65;10;20M\x1b[<64;10;20M')).toBe(true)
  })

  it('recognizes default-encoded wheel reports', () => {
    const report = `\x1b[M${String.fromCharCode(64 + 32)}!!`

    expect(isTerminalWheelInput(report)).toBe(true)
  })

  it('rejects mouse moves, releases, mixed input, and malformed reports', () => {
    expect(isTerminalWheelInput('\x1b[<35;10;20M')).toBe(false)
    expect(isTerminalWheelInput('\x1b[<64;10;20m')).toBe(false)
    expect(isTerminalWheelInput('\x1b[<64;10;20Mabc')).toBe(false)
    expect(isTerminalWheelInput('a')).toBe(false)
  })
})

describe('createTerminalWheelInputBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(holdForegroundTerminalOutput).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches wheel input until the burst goes idle', () => {
    const terminal = {}
    const sendInput = vi.fn(() => true)
    const batcher = createTerminalWheelInputBatcher({
      terminal: terminal as never,
      sendInput
    })

    expect(batcher.enqueueIfWheelInput('\x1b[<64;10;20M')).toBe(true)
    expect(batcher.enqueueIfWheelInput('\x1b[<65;10;20M')).toBe(true)
    expect(sendInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(139)
    expect(sendInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(sendInput).toHaveBeenCalledTimes(1)
    expect(sendInput).toHaveBeenCalledWith('\x1b[<64;10;20M\x1b[<65;10;20M')
    expect(holdForegroundTerminalOutput).toHaveBeenCalledWith(terminal, {
      idleMs: 96,
      maxMs: 2000
    })
  })

  it('flushes at the maximum batch time during continuous wheel input', () => {
    const sendInput = vi.fn(() => true)
    const batcher = createTerminalWheelInputBatcher({
      terminal: {} as never,
      sendInput
    })

    for (let i = 0; i < 11; i++) {
      expect(batcher.enqueueIfWheelInput('\x1b[<64;10;20M')).toBe(true)
      if (i < 10) {
        vi.advanceTimersByTime(139)
      }
    }

    vi.advanceTimersByTime(109)
    expect(sendInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(sendInput).toHaveBeenCalledTimes(1)
    expect(sendInput).toHaveBeenCalledWith('\x1b[<64;10;20M'.repeat(11))
  })

  it('does not claim non-wheel input', () => {
    const sendInput = vi.fn(() => true)
    const batcher = createTerminalWheelInputBatcher({
      terminal: {} as never,
      sendInput
    })

    expect(batcher.enqueueIfWheelInput('\x03')).toBe(false)
    expect(sendInput).not.toHaveBeenCalled()
  })

  it('drops delayed wheel input when the live send guard fails before flush', () => {
    let canSend = true
    const sendInput = vi.fn(() => true)
    const batcher = createTerminalWheelInputBatcher({
      terminal: {} as never,
      sendInput,
      canSend: () => canSend
    })

    expect(batcher.enqueueIfWheelInput('\x1b[<64;10;20M')).toBe(true)
    canSend = false
    vi.advanceTimersByTime(140)

    expect(sendInput).not.toHaveBeenCalled()
    expect(holdForegroundTerminalOutput).toHaveBeenCalledTimes(1)
  })

  it('flushes and discards pending input on demand', () => {
    const sendInput = vi.fn(() => true)
    const batcher = createTerminalWheelInputBatcher({
      terminal: {} as never,
      sendInput
    })

    batcher.enqueueIfWheelInput('\x1b[<64;10;20M')
    batcher.flush()
    expect(sendInput).toHaveBeenCalledWith('\x1b[<64;10;20M')

    batcher.enqueueIfWheelInput('\x1b[<65;10;20M')
    batcher.discard()
    vi.advanceTimersByTime(1500)
    expect(sendInput).toHaveBeenCalledTimes(1)
  })
})
