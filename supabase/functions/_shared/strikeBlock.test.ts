import { describe, expect, it } from 'vitest'

import { strikeBlock, type TiptapNode } from './strikeBlock.ts'

const para = (id: string, ...texts: string[]): TiptapNode => ({
  type: 'paragraph',
  attrs: { id },
  content: texts.map((text) => ({ type: 'text', text })),
})

const doc = (...content: TiptapNode[]): TiptapNode => ({ type: 'doc', content })

const marksOf = (node: TiptapNode): string[][] =>
  (node.content ?? []).map((t) => (t.marks ?? []).map((m) => String(m.type)))

describe('strikeBlock', () => {
  it('strikes every text node in the target block', () => {
    const before = doc(para('a', 'Dietician appointment ', '8/17 8:20am'), para('b', 'other'))
    const { doc: after, found } = strikeBlock(before, 'a')

    expect(found).toBe(true)
    expect(marksOf(after.content![0])).toEqual([['strike'], ['strike']])
    expect(marksOf(after.content![1])).toEqual([[]]) // untouched
  })

  it('preserves existing marks alongside the strike', () => {
    const before = doc({
      type: 'paragraph',
      attrs: { id: 'a' },
      content: [
        { type: 'text', text: '8/17', marks: [{ type: 'highlight', attrs: { color: '#67e8f9' } }] },
      ],
    })
    const { doc: after } = strikeBlock(before, 'a')
    expect(marksOf(after.content![0])).toEqual([['highlight', 'strike']])
  })

  it('is idempotent on an already-struck block', () => {
    const once = strikeBlock(doc(para('a', 'done thing')), 'a').doc
    const twice = strikeBlock(once, 'a').doc
    expect(twice).toEqual(once)
  })

  it('also ticks the checkbox when the block is inside a taskItem', () => {
    const before = doc({
      type: 'taskList',
      attrs: { id: 'list' },
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('a', 'buy gels')] }],
    })
    const { doc: after } = strikeBlock(before, 'a')
    const item = after.content![0].content![0]
    expect(item.attrs?.checked).toBe(true)
    expect(marksOf(item.content![0])).toEqual([['strike']])
  })

  it('leaves a plain listItem parent alone', () => {
    const before = doc({
      type: 'bulletList',
      attrs: { id: 'list' },
      content: [{ type: 'listItem', content: [para('a', 'buy gels')] }],
    })
    const { doc: after } = strikeBlock(before, 'a')
    expect(after.content![0].content![0].attrs?.checked).toBeUndefined()
  })

  it('returns the original doc for an unknown id', () => {
    const before = doc(para('a', 'x'))
    const result = strikeBlock(before, 'nope')
    expect(result.found).toBe(false)
    expect(result.doc).toBe(before)
  })

  it('does not mutate the input', () => {
    const before = doc(para('a', 'x'))
    const snapshot = JSON.parse(JSON.stringify(before))
    strikeBlock(before, 'a')
    expect(before).toEqual(snapshot)
  })
})
