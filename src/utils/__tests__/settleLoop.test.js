import { describe, it, expect } from 'vitest'
import { createSettleLoop } from '../settleLoop'

// A fake clock + manual rAF queue so we can drive the bounded settle loop
// deterministically: `now` is advanced by hand, `raf` records the next callback,
// and `flush` runs the pending frame (optionally advancing the clock first).
function makeHarness() {
  let time = 0
  let pending = null
  let nextId = 1
  const cancelled = []

  const raf = (cb) => {
    pending = cb
    return nextId++
  }
  const caf = (id) => {
    cancelled.push(id)
    pending = null
  }
  const now = () => time

  return {
    now,
    raf,
    caf,
    cancelled,
    advance(ms) {
      time += ms
    },
    // Run the currently-scheduled frame, advancing the clock by `dt` first.
    flush(dt = 16) {
      time += dt
      const cb = pending
      pending = null
      if (cb) cb()
    },
    hasPending() {
      return pending !== null
    },
  }
}

describe('createSettleLoop', () => {
  it('ticks every frame across the window then stops at the deadline', () => {
    const h = makeHarness()
    let ticks = 0
    createSettleLoop({
      durationMs: 50,
      onTick: () => ticks++,
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })

    // Frames at t=16, 32, 48 are all before the 50ms deadline → keep going.
    h.flush(16)
    h.flush(16)
    h.flush(16)
    expect(ticks).toBe(3)
    expect(h.hasPending()).toBe(true)

    // Frame at t=64 runs its tick, then sees now >= deadline → stops.
    h.flush(16)
    expect(ticks).toBe(4)
    expect(h.hasPending()).toBe(false)
  })

  it('refresh extends the deadline so ticking continues past the original window', () => {
    const h = makeHarness()
    let ticks = 0
    const loop = createSettleLoop({
      durationMs: 50,
      onTick: () => ticks++,
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })

    h.flush(16) // t=16
    h.flush(16) // t=32

    // A new resize at t=32 refreshes the deadline to t=82.
    loop.refresh()

    h.flush(16) // t=48 — would have been past old 50? no, but keeps going
    h.flush(16) // t=64 — past original 50ms deadline, still ticks thanks to refresh
    expect(ticks).toBe(4)
    expect(h.hasPending()).toBe(true)

    // Now let it run out the refreshed window (deadline t=82).
    h.flush(16) // t=80 — still before 82
    expect(ticks).toBe(5)
    expect(h.hasPending()).toBe(true)
    h.flush(16) // t=96 — past 82 → stops
    expect(ticks).toBe(6)
    expect(h.hasPending()).toBe(false)
  })

  it('refresh restarts the loop after it has already settled', () => {
    const h = makeHarness()
    let ticks = 0
    const loop = createSettleLoop({
      durationMs: 30,
      onTick: () => ticks++,
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })

    h.flush(40) // t=40 — past 30ms deadline → loop stops
    expect(ticks).toBe(1)
    expect(h.hasPending()).toBe(false)

    // A later resize should kick the loop back off.
    loop.refresh()
    expect(h.hasPending()).toBe(true)
    h.flush(16) // t=56 — before new deadline t=70
    expect(ticks).toBe(2)
    expect(h.hasPending()).toBe(true)
  })

  it('cancel stops the loop and cancels the pending frame', () => {
    const h = makeHarness()
    let ticks = 0
    const loop = createSettleLoop({
      durationMs: 100,
      onTick: () => ticks++,
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })

    h.flush(16)
    expect(ticks).toBe(1)

    loop.cancel()
    expect(h.cancelled.length).toBe(1)
    expect(h.hasPending()).toBe(false)

    // refresh after cancel is a no-op; no further ticks.
    loop.refresh()
    expect(h.hasPending()).toBe(false)
    expect(ticks).toBe(1)
  })
})
