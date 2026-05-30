import { describe, expect, it } from 'vitest'

import { splitMessage } from './format.ts'

describe('splitMessage', () => {
  it('returns empty array for empty/blank input', () => {
    expect(splitMessage('')).toEqual([])
    expect(splitMessage('   \n  ')).toEqual([])
    expect(splitMessage(null)).toEqual([])
    expect(splitMessage(undefined)).toEqual([])
  })

  it('returns a single chunk when under the limit', () => {
    expect(splitMessage('hello world', 4096)).toEqual(['hello world'])
  })

  it('splits on newline boundaries when possible', () => {
    const text = 'line one\nline two\nline three'
    const chunks = splitMessage(text, 12)
    expect(chunks.every((c) => c.length <= 12)).toBe(true)
    expect(chunks.join('\n')).toContain('line one')
    expect(chunks.join(' ')).toContain('three')
  })

  it('falls back to space boundaries when there is no newline', () => {
    const chunks = splitMessage('aaaa bbbb cccc dddd', 9)
    expect(chunks.every((c) => c.length <= 9)).toBe(true)
  })

  it('hard-cuts a single oversized token', () => {
    const chunks = splitMessage('x'.repeat(25), 10)
    expect(chunks.every((c) => c.length <= 10)).toBe(true)
    expect(chunks.join('')).toBe('x'.repeat(25))
  })

  it('never loses content', () => {
    const text = Array.from({ length: 50 }, (_, i) => `item ${i}`).join('\n')
    const chunks = splitMessage(text, 20)
    const rejoined = chunks.join(' ').replace(/\s+/g, ' ')
    for (let i = 0; i < 50; i++) expect(rejoined).toContain(`item ${i}`)
  })
})
