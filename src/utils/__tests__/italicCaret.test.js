import { describe, it, expect } from 'vitest'
import {
  shouldShowItalicCaret,
  caretStyleFromRect,
  ITALIC_CARET_SKEW_DEG,
} from '../italicCaret'

describe('shouldShowItalicCaret', () => {
  it('shows the caret when focused, collapsed, and italic is active', () => {
    expect(
      shouldShowItalicCaret({ focused: true, selectionEmpty: true, italicActive: true }),
    ).toBe(true)
  })

  it('hides the caret when the editor is not focused', () => {
    expect(
      shouldShowItalicCaret({ focused: false, selectionEmpty: true, italicActive: true }),
    ).toBe(false)
  })

  it('hides the caret when the selection is a range (not collapsed)', () => {
    expect(
      shouldShowItalicCaret({ focused: true, selectionEmpty: false, italicActive: true }),
    ).toBe(false)
  })

  it('hides the caret when italic is not active', () => {
    expect(
      shouldShowItalicCaret({ focused: true, selectionEmpty: true, italicActive: false }),
    ).toBe(false)
  })

  it('does not gate on pointer type — extra fields are ignored', () => {
    expect(
      shouldShowItalicCaret({
        focused: true,
        selectionEmpty: true,
        italicActive: true,
        pointerFine: false,
      }),
    ).toBe(true)
  })

  it('coerces missing fields to false rather than throwing', () => {
    expect(shouldShowItalicCaret({})).toBe(false)
  })
})

describe('caretStyleFromRect', () => {
  it('derives height from the rect and positions from top/left', () => {
    const style = caretStyleFromRect({ left: 120, top: 200, bottom: 219 })
    expect(style.left).toBe(120)
    expect(style.top).toBe(200)
    expect(style.height).toBe(19)
  })

  it('applies a negative skewX transform matching the measured italic angle', () => {
    const style = caretStyleFromRect({ left: 0, top: 0, bottom: 22 })
    expect(style.transform).toBe(`skewX(-${ITALIC_CARET_SKEW_DEG}deg)`)
    expect(style.height).toBe(22)
  })
})
