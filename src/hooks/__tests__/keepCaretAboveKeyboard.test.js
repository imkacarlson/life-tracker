import { describe, it, expect } from 'vitest'
import { shouldKeepCaretAboveKeyboard } from '../useKeepCaretAboveKeyboard'

describe('shouldKeepCaretAboveKeyboard', () => {
  it('acts when the keyboard is shown and the editor is focused', () => {
    expect(shouldKeepCaretAboveKeyboard({ keyboardShown: true, editorFocused: true })).toBe(true)
  })

  it('skips when the keyboard is not shown (close / chrome shrink)', () => {
    expect(shouldKeepCaretAboveKeyboard({ keyboardShown: false, editorFocused: true })).toBe(false)
  })

  it('skips when the editor is not focused (no caret to keep)', () => {
    expect(shouldKeepCaretAboveKeyboard({ keyboardShown: true, editorFocused: false })).toBe(false)
  })

  it('skips when neither condition holds', () => {
    expect(shouldKeepCaretAboveKeyboard({ keyboardShown: false, editorFocused: false })).toBe(false)
  })
})
