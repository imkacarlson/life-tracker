import { describe, it, expect } from 'vitest'
import { buildHash, parseDeepLink } from '../navigationHelpers'

describe('buildHash', () => {
  it('returns empty string when no params are provided', () => {
    expect(buildHash({})).toBe('')
  })

  it('builds hash with only notebookId', () => {
    expect(buildHash({ notebookId: 'abc' })).toBe('#nb=abc')
  })

  it('builds hash with all params', () => {
    const hash = buildHash({
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: 'pg1',
      blockId: 'block1',
    })
    expect(hash).toContain('nb=nb1')
    expect(hash).toContain('sec=sec1')
    expect(hash).toContain('pg=pg1')
    expect(hash).toContain('block=block1')
    expect(hash.startsWith('#')).toBe(true)
  })

  it('omits falsy params', () => {
    const hash = buildHash({ notebookId: 'nb1', sectionId: null, pageId: undefined })
    expect(hash).toBe('#nb=nb1')
  })
})

describe('parseDeepLink', () => {
  it('returns null for empty string', () => {
    expect(parseDeepLink('')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(parseDeepLink(null)).toBeNull()
    expect(parseDeepLink(undefined)).toBeNull()
  })

  it('returns null for hash without recognized prefix', () => {
    expect(parseDeepLink('#foo=bar')).toBeNull()
  })

  it('parses hash with all four params', () => {
    const result = parseDeepLink('#nb=nb1&sec=sec1&pg=pg1&block=block1')
    expect(result).toEqual({
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: 'pg1',
      blockId: 'block1',
    })
  })

  it('parses hash with only pageId', () => {
    const result = parseDeepLink('#pg=pg1')
    expect(result).toEqual({
      notebookId: null,
      sectionId: null,
      pageId: 'pg1',
      blockId: null,
    })
  })

  it('parses hash with notebookId and sectionId (no page)', () => {
    const result = parseDeepLink('#nb=nb1&sec=sec1')
    expect(result).toEqual({
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: null,
      blockId: null,
    })
  })

  it('returns null for block-only hash (known limitation)', () => {
    // buildHash({ blockId: 'xyz' }) produces '#block=xyz'
    // but parseDeepLink only accepts hashes starting with #pg=, #sec=, or #nb=
    expect(parseDeepLink('#block=xyz')).toBeNull()
  })
})

describe('buildHash + parseDeepLink roundtrip', () => {
  it('roundtrips notebookId + pageId', () => {
    const params = { notebookId: 'nb1', pageId: 'pg1' }
    const hash = buildHash(params)
    const parsed = parseDeepLink(hash)
    expect(parsed.notebookId).toBe('nb1')
    expect(parsed.pageId).toBe('pg1')
  })

  it('roundtrips all four params', () => {
    const params = {
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: 'pg1',
      blockId: 'block1',
    }
    const hash = buildHash(params)
    const parsed = parseDeepLink(hash)
    expect(parsed).toEqual(params)
  })

  it('block-only does NOT roundtrip (documented limitation)', () => {
    const hash = buildHash({ blockId: 'xyz' })
    expect(hash).toBe('#block=xyz')
    expect(parseDeepLink(hash)).toBeNull()
  })
})
