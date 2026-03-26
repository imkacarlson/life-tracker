import { describe, it, expect } from 'vitest'
import { normalizeContent, collectStoragePaths, sanitizeContentForSave } from '../contentHelpers'
import { EMPTY_DOC } from '../constants'

describe('normalizeContent', () => {
  it('returns EMPTY_DOC for null', () => {
    expect(normalizeContent(null)).toEqual(EMPTY_DOC)
  })

  it('returns EMPTY_DOC for undefined', () => {
    expect(normalizeContent(undefined)).toEqual(EMPTY_DOC)
  })

  it('returns EMPTY_DOC for a string', () => {
    expect(normalizeContent('hello')).toEqual(EMPTY_DOC)
  })

  it('returns EMPTY_DOC for an object without .type', () => {
    expect(normalizeContent({})).toEqual(EMPTY_DOC)
    expect(normalizeContent({ content: [] })).toEqual(EMPTY_DOC)
  })

  it('returns the content as-is when it has a .type', () => {
    const doc = { type: 'doc', content: [] }
    expect(normalizeContent(doc)).toBe(doc)
  })
})

describe('collectStoragePaths', () => {
  it('collects storagePath from a top-level image node', () => {
    const paths = new Set()
    collectStoragePaths({
      type: 'image',
      attrs: { storagePath: 'images/foo.png', src: 'https://example.com/foo.png' },
    }, paths)
    expect([...paths]).toEqual(['images/foo.png'])
  })

  it('collects paths from deeply nested images', () => {
    const paths = new Set()
    const doc = {
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{
              type: 'image',
              attrs: { storagePath: 'images/deep.jpg' },
            }],
          }],
        }],
      }],
    }
    collectStoragePaths(doc, paths)
    expect([...paths]).toEqual(['images/deep.jpg'])
  })

  it('deduplicates when the same path appears twice', () => {
    const paths = new Set()
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { storagePath: 'images/same.png' } },
        { type: 'image', attrs: { storagePath: 'images/same.png' } },
      ],
    }
    collectStoragePaths(doc, paths)
    expect([...paths]).toEqual(['images/same.png'])
  })

  it('skips image nodes without storagePath', () => {
    const paths = new Set()
    collectStoragePaths({
      type: 'image',
      attrs: { src: 'data:image/png;base64,...' },
    }, paths)
    expect([...paths]).toEqual([])
  })

  it('skips non-image nodes that happen to have storagePath', () => {
    const paths = new Set()
    collectStoragePaths({
      type: 'paragraph',
      attrs: { storagePath: 'images/nope.png' },
    }, paths)
    expect([...paths]).toEqual([])
  })

  it('handles null/undefined input gracefully', () => {
    const paths = new Set()
    collectStoragePaths(null, paths)
    collectStoragePaths(undefined, paths)
    expect([...paths]).toEqual([])
  })
})

describe('sanitizeContentForSave', () => {
  it('nulls out src on image nodes with storagePath', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'image',
        attrs: { storagePath: 'images/x.png', src: 'https://signed-url.com/x.png' },
      }],
    }
    const result = sanitizeContentForSave(content)
    expect(result.content[0].attrs.src).toBeNull()
    expect(result.content[0].attrs.storagePath).toBe('images/x.png')
  })

  it('sanitizes deeply nested images (inside list, inside table cell)', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [{
            type: 'tableCell',
            content: [{
              type: 'bulletList',
              content: [{
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [{
                    type: 'image',
                    attrs: { storagePath: 'images/nested.png', src: 'https://url.com/nested.png' },
                  }],
                }],
              }],
            }],
          }],
        }],
      }],
    }
    const result = sanitizeContentForSave(content)
    const img = result.content[0].content[0].content[0].content[0].content[0].content[0].content[0]
    expect(img.attrs.src).toBeNull()
    expect(img.attrs.storagePath).toBe('images/nested.png')
  })

  it('normalizes null content before sanitizing', () => {
    const result = sanitizeContentForSave(null)
    expect(result).toEqual(EMPTY_DOC)
  })

  it('leaves non-image nodes untouched', () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    }
    const result = sanitizeContentForSave(content)
    expect(result).toEqual(content)
  })
})
