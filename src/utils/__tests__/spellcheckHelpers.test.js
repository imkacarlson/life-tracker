import { describe, it, expect } from 'vitest'
import { findMisspellings } from '../spellcheckHelpers'

// A checker stub: any word in the set is "correct", everything else misspelled.
const makeChecker = (correctWords) => ({
  correct: (word) => correctWords.has(word),
})

describe('findMisspellings', () => {
  it('flags a misspelled word with offsets relative to the text', () => {
    const checker = makeChecker(new Set(['the', 'quick']))
    expect(findMisspellings('teh quick', checker)).toEqual([
      { word: 'teh', from: 0, to: 3 },
    ])
  })

  it('flags multiple misspellings in one string', () => {
    const checker = makeChecker(new Set(['brown', 'fox']))
    expect(findMisspellings('teh quikc brown fox', checker)).toEqual([
      { word: 'teh', from: 0, to: 3 },
      { word: 'quikc', from: 4, to: 9 },
    ])
  })

  it('returns nothing when every word is correct', () => {
    const checker = makeChecker(new Set(['the', 'quick', 'fox']))
    expect(findMisspellings('the quick fox', checker)).toEqual([])
  })

  it('skips words in the ignore set (case-insensitive)', () => {
    const checker = makeChecker(new Set())
    const ignore = new Set(['teh'])
    expect(findMisspellings('Teh teh', checker, { ignore })).toEqual([])
  })

  it('skips custom words the checker now considers correct', () => {
    // Simulates a proper noun added to the dictionary: the checker reports it
    // correct, so it must not be flagged even though it is not a real word.
    const checker = makeChecker(new Set(['Hello', 'Kacarlson']))
    expect(findMisspellings('Hello Kacarlson', checker)).toEqual([])
  })

  it('treats internal apostrophes as part of one word', () => {
    const checker = makeChecker(new Set(["don't", 'it', 's']))
    // "don't" is correct; "dont" is not.
    expect(findMisspellings("don't dont", checker)).toEqual([
      { word: 'dont', from: 6, to: 10 },
    ])
  })

  it('ignores digits and punctuation when tokenizing', () => {
    const checker = makeChecker(new Set(['run']))
    // "5k" -> only "k" is a token (single letter); numbers are not words.
    expect(findMisspellings('run 5k!', checker)).toEqual([
      { word: 'k', from: 5, to: 6 },
    ])
  })

  it('returns [] for empty text or a missing checker', () => {
    expect(findMisspellings('', makeChecker(new Set()))).toEqual([])
    expect(findMisspellings('hello', null)).toEqual([])
    expect(findMisspellings('hello', {})).toEqual([])
  })
})
