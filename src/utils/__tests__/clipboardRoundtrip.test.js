import { describe, it, expect, beforeAll } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { parseHTML } from 'linkedom'
import StarterKit from '@tiptap/starter-kit'
import ListItem from '@tiptap/extension-list-item'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { TableRow } from '@tiptap/extension-table'
import {
  ParagraphWithId,
  HeadingWithId,
  BulletListWithId,
  OrderedListWithId,
  TaskListWithId,
} from '../../extensions/nodeExtensions'
import {
  TableWithId,
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '../../extensions/tableExtensions'
import { SecureImage, InternalLink } from '../../extensions/editorExtensions'
import { stripClipboardIds } from '../clipboardHelpers'

// Mirrors the production extension set (sans React-only view extensions) so the
// real renderHTML/parseHTML pairs are exercised. This is the deterministic
// stand-in for a clipboard round-trip: serialize -> HTML -> parse, the exact
// path ProseMirror uses for copy/paste, minus the flaky OS clipboard.
let schema
let document

beforeAll(() => {
  schema = getSchema([
    StarterKit.configure({
      bulletList: false,
      orderedList: false,
      listItem: false,
      link: false,
      underline: false,
      paragraph: false,
      heading: false,
    }),
    ParagraphWithId,
    HeadingWithId,
    BulletListWithId,
    OrderedListWithId,
    ListItem,
    TaskListWithId.configure({ nested: true }),
    TaskItem.configure({ nested: true }),
    Underline,
    Highlight.configure({ multicolor: true }).extend({ inclusive: false }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    InternalLink.configure({ openOnClick: false }),
    SecureImage.configure({ inline: false, allowBase64: false }),
    TableWithId.configure({ resizable: true }),
    TableRow,
    TableHeaderWithBackground,
    TableCellWithBackground,
  ])
  document = parseHTML('<!doctype html><html><body></body></html>').document
})

// Round-trip a doc JSON through serialize -> HTML -> parse and return the
// resulting doc JSON. Strips clipboard IDs first (as transformCopied does).
const roundTrip = (docJson) => {
  const node = schema.nodeFromJSON(docJson)
  const slice = stripClipboardIds({ content: node.content, openStart: 0, openEnd: 0 })
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(slice.content, { document })
  const container = document.createElement('div')
  container.appendChild(fragment)
  const parsed = DOMParser.fromSchema(schema).parse(container)
  return { json: parsed.toJSON(), html: container.innerHTML }
}

const firstParagraph = (json) => json.content.find((n) => n.type === 'paragraph')
const textNodesOf = (node) => node.content ?? []

describe('clipboard round-trip fidelity', () => {
  it('preserves an internal #pg= link (the reported regression)', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'link', attrs: { href: '#pg=abc123' } }], text: 'go' },
          ],
        },
      ],
    })
    const linkNode = textNodesOf(firstParagraph(json)).find((n) => n.text === 'go')
    const linkMark = linkNode.marks?.find((m) => m.type === 'link')
    expect(linkMark).toBeTruthy()
    expect(linkMark.attrs.href).toBe('#pg=abc123')
  })

  it('preserves an external https link', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/path' } }],
              text: 'site',
            },
          ],
        },
      ],
    })
    const linkNode = textNodesOf(firstParagraph(json)).find((n) => n.text === 'site')
    const linkMark = linkNode.marks?.find((m) => m.type === 'link')
    expect(linkMark?.attrs.href).toBe('https://example.com/path')
  })

  it('round-trips a 3-level nested bullet with partial highlight, bold, and a link identically', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'L1 ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
                  ],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'L2' }] },
                        {
                          type: 'bulletList',
                          content: [
                            {
                              type: 'listItem',
                              content: [
                                {
                                  type: 'paragraph',
                                  content: [
                                    { type: 'text', text: 'due ' },
                                    {
                                      type: 'text',
                                      marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }],
                                      text: '2/22',
                                    },
                                    { type: 'text', text: ' ' },
                                    {
                                      type: 'text',
                                      marks: [{ type: 'link', attrs: { href: '#pg=deep' } }],
                                      text: 'ref',
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const { json } = roundTrip(source)
    // Walk to the deepest paragraph and verify the precise inline spans survived.
    const deepText = JSON.stringify(json)
    expect(deepText).toContain('"href":"#pg=deep"')
    expect(deepText).toContain('"color":"#fef08a"')
    // Highlight must stay on "2/22" only — no bleed onto "due ".
    const findText = (node, target) => {
      if (node.text === target) return node
      for (const child of node.content ?? []) {
        const hit = findText(child, target)
        if (hit) return hit
      }
      return null
    }
    const dueNode = findText({ content: json.content }, 'due ')
    expect(dueNode.marks?.some((m) => m.type === 'highlight')).toBeFalsy()
    const dateNode = findText({ content: json.content }, '2/22')
    expect(dateNode.marks?.some((m) => m.type === 'highlight')).toBe(true)
    // Three levels of nesting preserved.
    const depth = (deepText.match(/"type":"bulletList"/g) || []).length
    expect(depth).toBe(3)
  })

  it('preserves paragraph text alignment', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'r' }] },
      ],
    })
    expect(firstParagraph(json).attrs.textAlign).toBe('right')
  })

  it('preserves a table cell background color', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { backgroundColor: '#ffcccc' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    const str = JSON.stringify(json)
    expect(str).toContain('"backgroundColor":"#ffcccc"')
  })

  it('preserves task item checked state', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
            },
          ],
        },
      ],
    })
    const str = JSON.stringify(json)
    expect(str).toContain('"checked":true')
  })

  it('preserves the image storage path', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [],
        },
        {
          type: 'image',
          attrs: { src: 'blob:signed-url', storagePath: 'user-id/pic.png' },
        },
      ],
    })
    const str = JSON.stringify(json)
    expect(str).toContain('"storagePath":"user-id/pic.png"')
  })

  it('preserves underline and text color', () => {
    const { json } = roundTrip({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'underline' }], text: 'u' },
            {
              type: 'text',
              marks: [{ type: 'textStyle', attrs: { color: '#3366ff' } }],
              text: 'c',
            },
          ],
        },
      ],
    })
    const str = JSON.stringify(json)
    expect(str).toContain('"type":"underline"')
    expect(str).toContain('#3366ff')
  })
})
