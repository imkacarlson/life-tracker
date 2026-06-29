// Pure spell-check text scanning, isolated from ProseMirror and the DOM so it
// can be unit-tested with a plain checker stub. Tokenizes a string into words
// and returns the ranges of those the checker flags as misspelled.

// A word is a run of letters, optionally joined by internal apostrophes
// (don't, it's, O'Brien). Digits and standalone punctuation are not part of a
// word, so number-bearing tokens never get flagged. Offsets in the returned
// ranges are relative to the start of `text`.
const WORD_REGEX = /[A-Za-z]+(?:['’][A-Za-z]+)*/g

/**
 * @param {string} text - Plain text to scan.
 * @param {{ correct: (word: string) => boolean }} checker - Spell checker.
 * @param {{ ignore?: Set<string> }} [options] - `ignore` holds lowercased words
 *   to skip (session "Ignore" list). Custom-dictionary words are skipped by the
 *   checker itself (they're added to nspell), so they don't need to be here.
 * @returns {Array<{ word: string, from: number, to: number }>}
 */
export const findMisspellings = (text, checker, options = {}) => {
  if (!text || !checker || typeof checker.correct !== 'function') return []

  const ignore = options.ignore
  const results = []
  let match

  WORD_REGEX.lastIndex = 0
  while ((match = WORD_REGEX.exec(text)) !== null) {
    const word = match[0]
    const lower = word.toLowerCase()
    if (ignore && ignore.has(lower)) continue
    if (checker.correct(word)) continue
    results.push({ word, from: match.index, to: match.index + word.length })
  }

  return results
}
