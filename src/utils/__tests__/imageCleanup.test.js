import { describe, it, expect } from 'vitest'
import {
  findRemovedImagePaths,
  collectAllImagePaths,
  collectImagePathsForCleanup,
} from '../imageCleanup'

// Helper to build a minimal Tiptap doc with image nodes
const makeDoc = (...imagePaths) => ({
  type: 'doc',
  content: imagePaths.map((p) => ({
    type: 'image',
    attrs: { storagePath: p, src: null },
  })),
})

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

describe('findRemovedImagePaths', () => {
  it('returns removed paths when an image is deleted', () => {
    const old = makeDoc('images/a.png', 'images/b.png')
    const next = makeDoc('images/a.png')
    expect(findRemovedImagePaths(old, next)).toEqual(['images/b.png'])
  })

  it('returns empty array when images are the same', () => {
    const doc = makeDoc('images/a.png', 'images/b.png')
    expect(findRemovedImagePaths(doc, doc)).toEqual([])
  })

  it('returns empty array when old content has no images', () => {
    expect(findRemovedImagePaths(emptyDoc, makeDoc('images/new.png'))).toEqual([])
  })

  it('returns all old paths when new content is empty', () => {
    const old = makeDoc('images/a.png', 'images/b.png')
    expect(findRemovedImagePaths(old, emptyDoc)).toEqual(['images/a.png', 'images/b.png'])
  })

  it('returns empty array for null/undefined inputs (error path)', () => {
    expect(findRemovedImagePaths(null, null)).toEqual([])
    expect(findRemovedImagePaths(undefined, undefined)).toEqual([])
  })

  it('handles multiple removals', () => {
    const old = makeDoc('images/a.png', 'images/b.png', 'images/c.png')
    const next = makeDoc('images/b.png')
    const removed = findRemovedImagePaths(old, next)
    expect(removed).toContain('images/a.png')
    expect(removed).toContain('images/c.png')
    expect(removed).not.toContain('images/b.png')
  })
})

describe('collectAllImagePaths', () => {
  it('collects paths from multiple pages', () => {
    const pages = [
      { id: '1', content: makeDoc('images/page1.png') },
      { id: '2', content: makeDoc('images/page2.png', 'images/page2b.png') },
    ]
    const paths = collectAllImagePaths(pages)
    expect(paths).toContain('images/page1.png')
    expect(paths).toContain('images/page2.png')
    expect(paths).toContain('images/page2b.png')
  })

  it('returns empty array for empty pages array', () => {
    expect(collectAllImagePaths([])).toEqual([])
  })

  it('gracefully skips pages with null content', () => {
    const pages = [
      { id: '1', content: null },
      { id: '2', content: makeDoc('images/ok.png') },
    ]
    const paths = collectAllImagePaths(pages)
    expect(paths).toEqual(['images/ok.png'])
  })

  it('gracefully skips pages with no content key', () => {
    const pages = [
      { id: '1' },
      { id: '2', content: makeDoc('images/yes.png') },
    ]
    const paths = collectAllImagePaths(pages)
    expect(paths).toEqual(['images/yes.png'])
  })

  it('deduplicates paths shared across pages', () => {
    const pages = [
      { id: '1', content: makeDoc('images/shared.png') },
      { id: '2', content: makeDoc('images/shared.png') },
    ]
    const paths = collectAllImagePaths(pages)
    expect(paths).toEqual(['images/shared.png'])
  })
})

describe('collectImagePathsForCleanup', () => {
  it('merges pages observed across settling reads', async () => {
    const responses = [
      { data: [], error: null },
      { data: [{ id: '1', content: makeDoc('images/a.png') }], error: null },
      {
        data: [
          { id: '1', content: makeDoc('images/a.png') },
          { id: '2', content: makeDoc('images/b.png') },
        ],
        error: null,
      },
      {
        data: [
          { id: '1', content: makeDoc('images/a.png') },
          { id: '2', content: makeDoc('images/b.png') },
        ],
        error: null,
      },
    ]
    let index = 0

    const result = await collectImagePathsForCleanup(
      async () => responses[index++] ?? responses.at(-1),
      { attempts: 4, delayMs: 0 },
    )

    expect(result.error).toBeNull()
    expect(result.imagePaths).toEqual(['images/a.png', 'images/b.png'])
  })

  it('returns partial image paths with the query error when a later read fails', async () => {
    const responses = [
      { data: [{ id: '1', content: makeDoc('images/a.png') }], error: null },
      { data: null, error: new Error('Bad Gateway') },
    ]
    let index = 0

    const result = await collectImagePathsForCleanup(
      async () => responses[index++] ?? responses.at(-1),
      { attempts: 2, delayMs: 0 },
    )

    expect(result.imagePaths).toEqual(['images/a.png'])
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.message).toContain('Bad Gateway')
  })
})
