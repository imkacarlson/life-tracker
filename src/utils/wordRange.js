// Pure ProseMirror-state helper: find the whitespace-delimited word under a
// collapsed cursor. Mirrors the pure-state pattern in
// extensions/keyboard/blockSelectionHelper.js (getBlockTextRange) — read the
// resolved position, work in the parent's text content, and map back to
// document positions via $from.start().

const isWhitespace = (char) => /\s/.test(char)

/**
 * Returns { from, to } document positions for the whitespace-delimited word
 * under a collapsed cursor, or null when there's no word to act on.
 *
 * Returns null when:
 *  - there's a real (non-empty) selection,
 *  - the cursor isn't inside a text block,
 *  - the cursor sits on whitespace (no word).
 *
 * Note: parent text offsets map cleanly to document positions for plain-text
 * blocks (the normal tracker case). Inline atom nodes are out of scope.
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @returns {{ from: number, to: number } | null}
 */
export const getWordRangeAt = (state) => {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  const parent = $from.parent
  if (!parent || !parent.isTextblock) return null

  const text = parent.textContent
  const offset = $from.parentOffset

  // Scan left to the start of the word.
  let start = offset
  while (start > 0 && !isWhitespace(text[start - 1])) start -= 1

  // Scan right to the end of the word.
  let end = offset
  while (end < text.length && !isWhitespace(text[end])) end += 1

  // No word: cursor is on whitespace (or an empty block).
  if (start === end) return null

  // $from.start() is the document position at the start of the parent's content.
  const base = $from.start()
  return { from: base + start, to: base + end }
}
