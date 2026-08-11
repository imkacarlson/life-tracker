import { describe, expect, it } from 'vitest'
import {
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from '../sidebarLayout'

describe('clampSidebarWidth', () => {
  it('enforces the minimum sidebar width', () => {
    expect(clampSidebarWidth(100, 1200)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('leaves a valid width unchanged', () => {
    expect(clampSidebarWidth(320, 1200)).toBe(320)
  })

  it('reserves room for the editor and resizer', () => {
    expect(clampSidebarWidth(900, 1000)).toBe(466)
  })

  it('falls back to the sidebar minimum in a narrow workspace', () => {
    expect(clampSidebarWidth(400, 600)).toBe(MIN_SIDEBAR_WIDTH)
  })
})
