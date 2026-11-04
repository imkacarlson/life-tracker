import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { parseHTML } from 'linkedom'
import {
  describeClickTarget,
  describeShortcut,
  diffDocSummaries,
  summarizeDoc,
  trimRecentEvents,
  truncate,
} from '../activityHelpers'

// Minimal schema with the node and mark types summarizeDoc looks at.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    bulletList: { group: 'block', content: 'listItem+' },
    taskList: { group: 'block', content: 'taskItem+' },
    listItem: { content: 'paragraph block*' },
    taskItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
  },
  marks: { strike: {} },
})

const { doc, paragraph, bulletList, taskList, listItem, taskItem } = schema.nodes
const strike = schema.marks.strike.create()

const p = (text, marks) => paragraph.create(null, text ? schema.text(text, marks) : null)
const li = (text, { struck = false, children = [] } = {}) =>
  listItem.create(null, [p(text, struck ? [strike] : undefined), ...children])
const ti = (text, checked = false) => taskItem.create({ checked }, [p(text)])
const ul = (...items) => bulletList.create(null, items)
const tl = (...items) => taskList.create(null, items)
const makeDoc = (...blocks) => doc.create(null, blocks)

describe('truncate', () => {
  it('leaves short text alone and cuts long text', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 3)).toBe('abc…')
    expect(truncate(null)).toBe('')
  })
})

describe('trimRecentEvents', () => {
  const at = (ms) => ({ occurred_at: new Date(ms).toISOString() })

  it('drops events outside the window', () => {
    const events = [at(0), at(5_000), at(9_000)]
    expect(trimRecentEvents(events, 10_000, 6_000, 10)).toEqual([at(5_000), at(9_000)])
  })

  it('keeps only the newest events past the cap', () => {
    const events = [at(1), at(2), at(3)]
    expect(trimRecentEvents(events, 10, 100, 2)).toEqual([at(2), at(3)])
  })
})

describe('describeShortcut', () => {
  it('ignores plain typing and lone modifiers', () => {
    expect(describeShortcut({ key: 'a' })).toBeNull()
    expect(describeShortcut({ key: 'Control', ctrlKey: true })).toBeNull()
  })

  it('names modifier combos', () => {
    expect(describeShortcut({ key: 'B', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+b')
    expect(describeShortcut({ key: 'Enter', metaKey: true })).toBe('meta+Enter')
  })
})

describe('describeClickTarget', () => {
  const { document } = parseHTML(`
    <div>
      <button aria-label="Open settings"><svg><path id="icon"/></svg></button>
      <button id="text-button">  Save
        note </button>
      <span id="plain">hello</span>
      <div class="ProseMirror"><a href="#x" id="editor-link">link</a></div>
    </div>
  `)

  it('uses the aria-label of the closest control', () => {
    expect(describeClickTarget(document.getElementById('icon'))).toEqual({
      label: 'Open settings',
      role: 'button',
    })
  })

  it('falls back to collapsed text content', () => {
    expect(describeClickTarget(document.getElementById('text-button')).label).toBe('Save note')
  })

  it('ignores non-controls and editor content', () => {
    expect(describeClickTarget(document.getElementById('plain'))).toBeNull()
    expect(describeClickTarget(document.getElementById('editor-link'))).toBeNull()
    expect(describeClickTarget(null)).toBeNull()
  })
})

describe('summarizeDoc', () => {
  it('collects list items and treats checked or fully struck items as done', () => {
    const summary = summarizeDoc(
      makeDoc(
        ul(li('Buy shoes', { struck: true }), li('Run 5k', { children: [ul(li('Stretch'))] })),
        tl(ti('Pay rent', true), ti('Call mom')),
      ),
    )
    expect([...summary.items].sort()).toEqual(['Buy shoes', 'Call mom', 'Pay rent', 'Run 5k', 'Stretch'])
    expect([...summary.done].sort()).toEqual(['Buy shoes', 'Pay rent'])
    expect(summary.openTasks).toBe(1)
  })

  it('does not count a parent as struck because of its children', () => {
    const summary = summarizeDoc(makeDoc(ul(li('Parent', { children: [ul(li('Kid', { struck: true }))] }))))
    expect([...summary.done]).toEqual(['Kid'])
  })
})

describe('diffDocSummaries', () => {
  it('reports added, removed, completed and uncompleted items', () => {
    const before = summarizeDoc(
      makeDoc(ul(li('Keep'), li('Delete me'), li('Finish me'), li('Reopen me', { struck: true }), li('Gone', { struck: true }))),
    )
    const after = summarizeDoc(
      makeDoc(ul(li('Keep'), li('New one'), li('Finish me', { struck: true }), li('Reopen me'))),
    )
    const diff = diffDocSummaries(before, after)

    expect(diff.items_added).toEqual(['New one'])
    expect(diff.items_removed.sort()).toEqual(['Delete me', 'Gone'])
    expect(diff.completed).toEqual(['Finish me'])
    // 'Gone' was deleted, not un-done.
    expect(diff.uncompleted).toEqual(['Reopen me'])
    expect(typeof diff.chars_delta).toBe('number')
  })
})
