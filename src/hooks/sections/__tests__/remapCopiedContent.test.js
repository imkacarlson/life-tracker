import { describe, expect, it } from 'vitest'
import { remapCopiedContents } from '../remapCopiedContent'

const idMaps = {
  pageIdMap: { 'page-old-a': 'page-new-a', 'page-old-b': 'page-new-b' },
  sectionId: { old: 'section-old', new: 'section-new' },
  notebookId: { old: 'notebook-old', new: 'notebook-new' },
}

const linkText = (text, href) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href, target: '_self' } }],
})

const makeFactories = () => {
  let id = 0
  return {
    createId: () => `new-block-${++id}`,
    createTimestamp: () => '2026-08-09T12:00:00.000Z',
  }
}

describe('remapCopiedContents', () => {
  it('regenerates navigable ids and timestamps without mutating source content', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'heading-old', created_at: 'old-time', level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'paragraph-old', created_at: 'old-time' },
          content: [{ type: 'text', text: 'Body' }],
        },
      ],
    }
    const snapshot = structuredClone(source)

    const [result] = remapCopiedContents([source], idMaps, makeFactories())

    expect(result.content[0].attrs).toMatchObject({
      id: 'new-block-1',
      created_at: '2026-08-09T12:00:00.000Z',
      level: 2,
    })
    expect(result.content[1].attrs.id).toBe('new-block-2')
    expect(source).toEqual(snapshot)
  })

  it('rewrites hierarchy ids plus self and forward block references', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'link-block' },
          content: [
            linkText(
              'forward',
              '#nb=notebook-old&sec=section-old&pg=page-old-a&block=target-block',
            ),
            linkText(
              'self',
              '#nb=notebook-old&sec=section-old&pg=page-old-a&block=link-block',
            ),
          ],
        },
        {
          type: 'paragraph',
          attrs: { id: 'target-block' },
          content: [{ type: 'text', text: 'Target' }],
        },
      ],
    }

    const [result] = remapCopiedContents([source], idMaps, makeFactories())
    const forwardHref = result.content[0].content[0].marks[0].attrs.href
    const selfHref = result.content[0].content[1].marks[0].attrs.href

    expect(forwardHref).toBe(
      '#nb=notebook-new&sec=section-new&pg=page-new-a&block=new-block-2',
    )
    expect(selfHref).toBe(
      '#nb=notebook-new&sec=section-new&pg=page-new-a&block=new-block-1',
    )
  })

  it('resolves block references across copied pages', () => {
    const firstPage = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'source-block' },
          content: [
            linkText(
              'other page',
              '#nb=notebook-old&sec=section-old&pg=page-old-b&block=later-block',
            ),
          ],
        },
      ],
    }
    const secondPage = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'later-block' },
          content: [{ type: 'text', text: 'Later' }],
        },
      ],
    }

    const [result] = remapCopiedContents(
      [firstPage, secondPage],
      idMaps,
      makeFactories(),
    )

    expect(result.content[0].content[0].marks[0].attrs.href).toBe(
      '#nb=notebook-new&sec=section-new&pg=page-new-b&block=new-block-2',
    )
  })

  it('leaves ordinary external links unchanged', () => {
    const externalMark = { type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }
    const source = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'paragraph-old' },
          content: [{ type: 'text', text: 'External', marks: [externalMark] }],
        },
      ],
    }

    const [result] = remapCopiedContents([source], idMaps, makeFactories())
    expect(result.content[0].content[0].marks[0]).toEqual(externalMark)
  })

  it('characterizes the existing independent notebook rewrite for outside-section links', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'paragraph-old' },
          content: [
            linkText(
              'outside',
              '#nb=notebook-old&sec=outside-section&pg=outside-page&block=outside-block',
            ),
          ],
        },
      ],
    }

    const [result] = remapCopiedContents([source], idMaps, makeFactories())
    expect(result.content[0].content[0].marks[0].attrs.href).toBe(
      '#nb=notebook-new&sec=outside-section&pg=outside-page&block=outside-block',
    )
  })

  it('preserves null page contents and output ordering', () => {
    const page = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'paragraph-old' } }],
    }
    const result = remapCopiedContents([null, page], idMaps, makeFactories())
    expect(result[0]).toBeNull()
    expect(result[1].content[0].attrs.id).toBe('new-block-1')
  })
})
