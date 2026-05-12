import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Module under test is reloaded between tests so the internal singleton state
// (the cached "is keyboard up" boolean and listener registration) starts clean.
let keyboardShownModule

function installFakeViewport({ height, layoutHeight }) {
  const listeners = { resize: new Set(), scroll: new Set() }
  const viewport = {
    height,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    addEventListener: vi.fn((type, fn) => listeners[type]?.add(fn)),
    removeEventListener: vi.fn((type, fn) => listeners[type]?.delete(fn)),
    _emit: (type) => listeners[type]?.forEach((fn) => fn()),
    _setHeight: (h) => { viewport.height = h },
  }
  globalThis.visualViewport = viewport
  globalThis.document = {
    documentElement: { clientHeight: layoutHeight },
  }
  return viewport
}

beforeEach(async () => {
  vi.resetModules()
  keyboardShownModule = await import('../keyboardShown')
})

afterEach(() => {
  keyboardShownModule.uninstallKeyboardShownTracker?.()
  delete globalThis.visualViewport
  delete globalThis.document
})

describe('isKeyboardShown', () => {
  it('returns false when visualViewport is unavailable', () => {
    delete globalThis.visualViewport
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)
  })

  it('returns false when visualViewport height is close to layout height', () => {
    installFakeViewport({ height: 800, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)
  })

  it('returns false when the delta is below the threshold (e.g. browser chrome shrink)', () => {
    installFakeViewport({ height: 700, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)
  })

  it('returns true when the visualViewport shrinks past the threshold', () => {
    installFakeViewport({ height: 400, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    expect(keyboardShownModule.isKeyboardShown()).toBe(true)
  })

  it('updates when the viewport resizes (keyboard opens after install)', () => {
    const viewport = installFakeViewport({ height: 800, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)

    viewport._setHeight(400)
    viewport._emit('resize')
    expect(keyboardShownModule.isKeyboardShown()).toBe(true)

    viewport._setHeight(800)
    viewport._emit('resize')
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)
  })

  it('uninstall removes listeners and resets state', () => {
    const viewport = installFakeViewport({ height: 400, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    expect(keyboardShownModule.isKeyboardShown()).toBe(true)

    keyboardShownModule.uninstallKeyboardShownTracker()
    expect(viewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(keyboardShownModule.isKeyboardShown()).toBe(false)
  })

  it('install is idempotent (re-installing does not double-subscribe)', () => {
    const viewport = installFakeViewport({ height: 800, layoutHeight: 800 })
    keyboardShownModule.installKeyboardShownTracker()
    keyboardShownModule.installKeyboardShownTracker()
    // First install: resize + scroll = 2 calls. Second should be a no-op.
    expect(viewport.addEventListener).toHaveBeenCalledTimes(2)
  })
})
