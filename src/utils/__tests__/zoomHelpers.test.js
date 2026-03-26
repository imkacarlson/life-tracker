import { describe, it, expect } from 'vitest'
import {
  pinchDistance,
  pinchMidpoint,
  clampZoom,
  anchoredScrollY,
  anchoredScrollX,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../zoomHelpers'

describe('pinchDistance', () => {
  it('returns 0 for same point', () => {
    const t = { clientX: 100, clientY: 200 }
    expect(pinchDistance(t, t)).toBe(0)
  })

  it('calculates horizontal distance', () => {
    const a = { clientX: 0, clientY: 0 }
    const b = { clientX: 3, clientY: 4 }
    expect(pinchDistance(a, b)).toBe(5)
  })

  it('is symmetric', () => {
    const a = { clientX: 10, clientY: 20 }
    const b = { clientX: 40, clientY: 60 }
    expect(pinchDistance(a, b)).toBe(pinchDistance(b, a))
  })
})

describe('pinchMidpoint', () => {
  it('returns midpoint of two touches', () => {
    const a = { clientX: 0, clientY: 0 }
    const b = { clientX: 100, clientY: 200 }
    expect(pinchMidpoint(a, b)).toEqual({ x: 50, y: 100 })
  })

  it('is symmetric', () => {
    const a = { clientX: 30, clientY: 70 }
    const b = { clientX: 90, clientY: 10 }
    expect(pinchMidpoint(a, b)).toEqual(pinchMidpoint(b, a))
  })
})

describe('clampZoom', () => {
  it('clamps below minimum', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
  })

  it('clamps above maximum', () => {
    expect(clampZoom(5)).toBe(MAX_ZOOM)
  })

  it('passes through values in range', () => {
    expect(clampZoom(1.0)).toBe(1.0)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('clamps exactly at boundaries', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })
})

describe('anchoredScrollY', () => {
  it('returns same scroll when zoom unchanged', () => {
    expect(anchoredScrollY(500, 300, 1.0, 1.0)).toBe(500)
  })

  it('adjusts scroll when zooming in', () => {
    // scrollY=0, midY=400, zoom 1.0 → 1.5
    // new = ((0 + 400) / 1.0) * 1.5 - 400 = 600 - 400 = 200
    expect(anchoredScrollY(0, 400, 1.0, 1.5)).toBe(200)
  })

  it('adjusts scroll when zooming out', () => {
    // scrollY=200, midY=400, zoom 1.5 → 1.0
    // new = ((200 + 400) / 1.5) * 1.0 - 400 = 400 - 400 = 0
    expect(anchoredScrollY(200, 400, 1.5, 1.0)).toBeCloseTo(0)
  })
})

describe('anchoredScrollX', () => {
  it('returns same scroll when zoom unchanged', () => {
    expect(anchoredScrollX(100, 200, 1.0, 1.0)).toBe(100)
  })

  it('adjusts scroll when zooming in', () => {
    // scrollX=0, midX=200, zoom 1.0 → 2.0
    // new = ((0 + 200) / 1.0) * 2.0 - 200 = 400 - 200 = 200
    expect(anchoredScrollX(0, 200, 1.0, 2.0)).toBe(200)
  })
})
