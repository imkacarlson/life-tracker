import { describe, expect, it } from 'vitest'
import {
  buildDailyInsertContent,
  buildDailyListItems,
  buildDailyRow,
} from '../dailyDocBuilders'

const linkContext = {
  notebookId: 'notebook-1',
  sectionId: 'section-1',
  sourcePageId: 'page-1',
}

describe('daily document builders', () => {
  it('builds numbered deep-link marks for task block ids', () => {
    const [item] = buildDailyListItems(
      [{ task: 'Pay invoice', block_ids: ['block-a', 'block-b'] }],
      linkContext,
    )
    const paragraphContent = item.content[0].content

    expect(paragraphContent.map((node) => node.text).join('')).toBe('Pay invoice [1] [2]')
    expect(paragraphContent[2].marks[0].attrs).toEqual({
      href: '#nb=notebook-1&sec=section-1&pg=page-1&block=block-a',
      target: '_self',
    })
    expect(paragraphContent[4].marks[0].attrs.href).toContain('block=block-b')
  })

  it('uses the existing template bullet list and appends generated tasks', () => {
    const templateItem = {
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template task' }] }],
    }
    const row = buildDailyRow({
      label: 'ASAP',
      tasks: [{ task: 'Generated task' }],
      extraNodes: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
        { type: 'bulletList', content: [templateItem] },
        { type: 'paragraph' },
      ],
      linkContext,
    })

    const cellContent = row.content[0].content
    expect(cellContent.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
      'bulletList',
    ])
    expect(cellContent[2].content).toHaveLength(2)
    expect(cellContent[2].content[1].content[0].content[0].text).toBe('Generated task')
  })

  it('keeps non-list template nodes and adds the empty placeholder list', () => {
    const row = buildDailyRow({
      label: 'ASAP',
      tasks: [],
      extraNodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template note' }] }],
      linkContext,
    })

    const cellContent = row.content[0].content
    expect(cellContent.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
      'bulletList',
    ])
    expect(cellContent[2].content[0].content[0].content[0].text).toBe('...')
  })

  it('assembles the dated heading, optional warning, and two-row table', () => {
    const content = buildDailyInsertContent({
      selectedDate: new Date(2026, 7, 9, 12),
      asapTasks: [{ task: 'ASAP task' }],
      fyiTasks: [{ task: 'FYI task' }],
      templateNodes: [],
      warning: 'Source content was truncated.',
      ...linkContext,
    })

    expect(content.map((node) => node.type)).toEqual(['heading', 'paragraph', 'table'])
    expect(content[0].content[0].text).toBe('August 9, 2026')
    expect(content[1].content[0]).toMatchObject({
      text: 'Source content was truncated.',
      marks: [{ type: 'italic' }],
    })
    expect(content[2].content).toHaveLength(2)
  })
})
