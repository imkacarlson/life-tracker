import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { Extension, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow, TableView, createColGroup } from '@tiptap/extension-table'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Placeholder from '@tiptap/extension-placeholder'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import './App.css'

const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

const STORAGE_KEY = 'life-tracker:lastSelection'

const readStoredSelection = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const normalizeContent = (content) => {
  if (content && typeof content === 'object' && content.type) return content
  return EMPTY_DOC
}

const withIdAttribute = (parentAttributes = {}) => ({
  ...parentAttributes,
  id: {
    default: null,
    parseHTML: (element) => element.getAttribute('id'),
    renderHTML: (attributes) => {
      if (!attributes.id) return {}
      return { id: attributes.id }
    },
  },
})

const ParagraphWithId = Paragraph.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
})

const HeadingWithId = Heading.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
})

const BulletListWithId = BulletList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ul', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})

const OrderedListWithId = OrderedList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ol', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})

const TaskListWithId = TaskList.extend({
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ HTMLAttributes }) {
    const parent = this.parent?.({ HTMLAttributes }) ?? ['ul', HTMLAttributes, 0]
    if (!HTMLAttributes?.id) return parent
    const [tag, attrs, content] = parent
    return [tag, { ...attrs, id: HTMLAttributes.id }, content]
  },
})

class TableViewWithId extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth)
    this.updateId(node)
  }

  update(node) {
    const result = super.update(node)
    if (result) {
      this.updateId(node)
    }
    return result
  }

  updateId(node) {
    const id = node?.attrs?.id
    if (id) {
      this.table.id = id
      return
    }
    this.table.removeAttribute('id')
  }
}

const applyBackgroundStyle = (HTMLAttributes, backgroundColor) => {
  if (!backgroundColor) return HTMLAttributes
  const existing = HTMLAttributes?.style ?? ''
  const suffix = existing && !existing.trim().endsWith(';') ? ';' : ''
  const style = `${existing}${suffix}background-color: ${backgroundColor};`
  return { ...HTMLAttributes, style }
}

const summarizeSlice = (slice) => {
  const lines = []
  const walk = (node, listDepth = 0) => {
    const name = node.type?.name
    let nextDepth = listDepth
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      nextDepth = listDepth + 1
    }
    if (name === 'paragraph' || name === 'heading') {
      lines.push({
        type: name,
        align: node.attrs?.textAlign ?? 'left',
        listDepth,
        text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })
    }
    node.content?.forEach((child) => walk(child, nextDepth))
  }
  walk(slice.content)
  return lines
}

const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style?.backgroundColor || null,
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = applyBackgroundStyle(HTMLAttributes, node.attrs?.backgroundColor)
    return ['td', mergeAttributes(this.options.HTMLAttributes, attrs), 0]
  },
})

const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style?.backgroundColor || null,
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = applyBackgroundStyle(HTMLAttributes, node.attrs?.backgroundColor)
    return ['th', mergeAttributes(this.options.HTMLAttributes, attrs), 0]
  },
})

const TableWithId = Table.extend({
  addOptions() {
    const parent = this.parent?.()
    return {
      ...(parent ?? {}),
      View: TableViewWithId,
    }
  },
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(
      node,
      this.options.cellMinWidth,
    )
    const userStyles = HTMLAttributes.style
    const style = userStyles || (tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`)
    const table = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style,
        id: HTMLAttributes.id || null,
      }),
      colgroup,
      ['tbody', 0],
    ]
    return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table
  },
})

const EnsureNodeIds = Extension.create({
  name: 'ensureNodeIds',
  addProseMirrorPlugins() {
    const types = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'table']
    return [
      new Plugin({
        key: new PluginKey('ensureNodeIds'),
        appendTransaction: (transactions, _oldState, newState) => {
          const hasChanges = transactions.some((tr) => tr.docChanged)
          const hasMeta = transactions.some((tr) => tr.getMeta('ensureNodeIds'))
          if (!hasChanges || hasMeta) return

          const tr = newState.tr
          let updated = false
          const seen = new Set()

          newState.doc.descendants((node, pos) => {
            if (!types.includes(node.type.name)) return
            let id = node.attrs?.id
            if (!id || seen.has(id)) {
              id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, id })
              updated = true
            }
            seen.add(id)
          })

          if (!updated) return
          tr.setMeta('ensureNodeIds', true)
          return tr
        },
      }),
    ]
  },
})

const SecureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
      },
    }
  },
})

const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const previous = this.editor.getAttributes('link')?.href ?? ''
        const nextUrl = window.prompt('Enter link URL', previous)
        if (nextUrl === null) return true
        const trimmed = nextUrl.trim()
        if (!trimmed) {
          this.editor.chain().focus().unsetLink().run()
          return true
        }
        const href =
          /^https?:\/\//i.test(trimmed) || trimmed.startsWith('#') ? trimmed : `https://${trimmed}`
        this.editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
        return true
      },
      'Mod--': () => {
        const { state, view } = this.editor
        const { from, to } = state.selection
        this.editor.chain().focus().toggleStrike().run()
        const nextState = this.editor.state
        const maxPos = nextState.doc.content.size
        const safeFrom = Math.min(from, maxPos)
        const safeTo = Math.min(to, maxPos)
        const selection = TextSelection.create(nextState.doc, safeFrom, safeTo)
        view.dispatch(nextState.tr.setSelection(selection))
        view.focus()
        return true
      },
      'Mod-.': () => {
        this.editor.chain().focus().toggleBulletList().run()
        return true
      },
      'Mod-Alt-h': () => {
        const isHighlighted = this.editor.isActive('highlight')
        if (isHighlighted) {
          this.editor.chain().focus().unsetHighlight().run()
          return true
        }
        const storedColor = this.editor.storage?.highlightColor
        if (storedColor === null) {
          return true
        }
        const currentColor =
          storedColor || this.editor.getAttributes('highlight')?.color || '#fef08a'
        this.editor.chain().focus().setHighlight({ color: currentColor }).run()
        return true
      },
    }
  },
})

const BoldShortcut = Extension.create({
  name: 'boldShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.chain().focus().toggleBold().run(),
    }
  },
})

const ListIndentShortcut = Extension.create({
  name: 'listIndentShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
    const findChildList = (node, listType) => {
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i)
        if (child.type === listType) {
          return { node: child, index: i }
        }
      }
      return null
    }

    const offsetBeforeIndex = (node, index) => {
      let offset = 0
      for (let i = 0; i < index; i += 1) {
        offset += node.child(i).nodeSize
      }
      return offset
    }

    const indentWithoutChildren = (itemTypeName) => {
      const { state, view } = this.editor
      const { selection } = state
      const { $from } = selection
      if (!$from) return false

      const itemType = state.schema.nodes[itemTypeName]
      if (!itemType) return false
      if (!selection.empty) {
        return this.editor.chain().focus().sinkListItem(itemTypeName).run()
      }

      let itemDepth = null
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type === itemType) {
          itemDepth = depth
          break
        }
      }
      if (!itemDepth) return false

      const listDepth = itemDepth - 1
      if (listDepth <= 0) return false

      const listNode = $from.node(listDepth)
      const listType = listNode.type
      const index = $from.index(listDepth)
      if (index === 0) return false

      const listItemNode = $from.node(itemDepth)
      const listItemPos = $from.before(itemDepth)
      const listPos = $from.before(listDepth)

      const childListInfo = findChildList(listItemNode, listType)
      if (!childListInfo) {
        return this.editor.chain().focus().sinkListItem(itemTypeName).run()
      }

      const prevItemNode = listNode.child(index - 1)
      const prevListInfo = findChildList(prevItemNode, listType)

      const strippedChildren = []
      for (let i = 0; i < listItemNode.childCount; i += 1) {
        if (i === childListInfo.index) continue
        strippedChildren.push(listItemNode.child(i))
      }
      const movedItem = listItemNode.copy(Fragment.fromArray(strippedChildren))

      const movedItems = [movedItem]
      childListInfo.node.content.forEach((child) => movedItems.push(child))

      let newPrevList = null
      let prevListOffset = 0

      if (prevListInfo) {
        const mergedContent = prevListInfo.node.content.append(Fragment.fromArray(movedItems))
        newPrevList = prevListInfo.node.copy(mergedContent)
      } else {
        newPrevList = listType.create(null, Fragment.fromArray(movedItems))
      }

      const prevItemChildren = []
      let runningOffset = 0
      for (let i = 0; i < prevItemNode.childCount; i += 1) {
        if (prevListInfo && i === prevListInfo.index) {
          prevListOffset = runningOffset
          prevItemChildren.push(newPrevList)
          runningOffset += newPrevList.nodeSize
          continue
        }
        const child = prevItemNode.child(i)
        prevItemChildren.push(child)
        runningOffset += child.nodeSize
      }
      if (!prevListInfo) {
        prevListOffset = runningOffset
        prevItemChildren.push(newPrevList)
      }

      const newPrevItem = prevItemNode.copy(Fragment.fromArray(prevItemChildren))

      const listChildren = []
      let prevItemOffset = 0
      let listOffset = 0
      for (let i = 0; i < listNode.childCount; i += 1) {
        if (i === index - 1) {
          prevItemOffset = listOffset
          listChildren.push(newPrevItem)
          listOffset += newPrevItem.nodeSize
          continue
        }
        if (i === index) {
          continue
        }
        const child = listNode.child(i)
        listChildren.push(child)
        listOffset += child.nodeSize
      }

      const newListNode = listNode.copy(Fragment.fromArray(listChildren))
      const tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, newListNode)

      const innerOffset = Math.max(0, selection.from - (listItemPos + 1))
      const clampedOffset = Math.min(innerOffset, movedItem.content.size)
      const movedIndex = prevListInfo ? prevListInfo.node.childCount : 0
      const movedOffset = offsetBeforeIndex(newPrevList, movedIndex)
      const prevItemPos = listPos + 1 + prevItemOffset
      const prevListPos = prevItemPos + 1 + prevListOffset
      const movedItemPos = prevListPos + 1 + movedOffset
      const selectionPos = movedItemPos + 1 + clampedOffset

      tr.setSelection(TextSelection.create(tr.doc, selectionPos))
      view.dispatch(tr.scrollIntoView())
      view.focus()
      return true
    }

    const indent = () => {
      if (this.editor.isActive('taskList') || this.editor.isActive('taskItem')) {
        return indentWithoutChildren('taskItem')
      }
      if (
        this.editor.isActive('bulletList') ||
        this.editor.isActive('orderedList') ||
        this.editor.isActive('listItem')
      ) {
        return indentWithoutChildren('listItem')
      }
      return false
    }

    return {
      Tab: () => indent(),
    }
  },
})

const ListSelectShortcut = Extension.create({
  name: 'listSelectShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        const findAncestor = (names) => {
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth)
            if (names.includes(node.type?.name)) {
              return { node, pos: $from.before(depth) }
            }
          }
          return null
        }

        const selectionCovers = (from, to) =>
          state.selection.from <= from && state.selection.to >= to

        const selectRange = (from, to) => {
          const selection = TextSelection.create(state.doc, from, to)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const selectCell = (pos) => {
          const selection = CellSelection.create(state.doc, pos)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const selectTable = (table) => {
          const map = TableMap.get(table.node)
          const tableStart = table.pos + 1
          const firstCellPos = tableStart + map.map[0]
          const lastCellPos = tableStart + map.map[map.map.length - 1]
          const selection = CellSelection.create(state.doc, firstCellPos, lastCellPos)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const isFullTableSelection = (table) => {
          if (!(state.selection instanceof CellSelection)) return false
          const map = TableMap.get(table.node)
          const tableStart = table.pos + 1
          const firstCellPos = tableStart + map.map[0]
          const lastCellPos = tableStart + map.map[map.map.length - 1]
          const anchorPos = state.selection.$anchorCell?.pos
          const headPos = state.selection.$headCell?.pos
          return (
            (anchorPos === firstCellPos && headPos === lastCellPos) ||
            (anchorPos === lastCellPos && headPos === firstCellPos)
          )
        }

        const list = findAncestor(['listItem', 'taskItem'])
        if (list) {
          let paragraphPos = null
          let paragraphSize = null
          list.node.content?.forEach((child, offset) => {
            if (paragraphPos !== null) return
            if (child.type?.name === 'paragraph') {
              paragraphPos = list.pos + 1 + offset
              paragraphSize = child.nodeSize
            }
          })
          const listFrom = paragraphPos !== null ? paragraphPos + 1 : list.pos + 1
          const listTo =
            paragraphPos !== null && paragraphSize
              ? paragraphPos + paragraphSize - 1
              : list.pos + list.node.nodeSize - 1
          if (!selectionCovers(listFrom, listTo)) {
            return selectRange(listFrom, listTo)
          }
        }

        const textBlock = findAncestor(['paragraph', 'heading'])
        if (!list && textBlock) {
          const blockFrom = textBlock.pos + 1
          const blockTo = textBlock.pos + textBlock.node.nodeSize - 1
          if (!selectionCovers(blockFrom, blockTo)) {
            return selectRange(blockFrom, blockTo)
          }
        }

        const cell = findAncestor(['tableCell', 'tableHeader'])
        if (cell) {
          if (!(state.selection instanceof CellSelection) || state.selection.$anchorCell?.pos !== cell.pos) {
            return selectCell(cell.pos)
          }
          const table = findAncestor(['table'])
          if (table && !isFullTableSelection(table)) {
            return selectTable(table)
          }
        }

        if (list || cell || textBlock) {
          this.editor.commands.selectAll()
          return true
        }

        return false
      },
    }
  },
})

const ListExitOnEmpty = Extension.create({
  name: 'listExitOnEmpty',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        if (!state.selection.empty) return false
        const { $from } = state.selection

        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type?.name !== 'listItem' && node.type?.name !== 'taskItem') continue
          const firstChild = node.childCount > 0 ? node.child(0) : null
          if (!firstChild || firstChild.type?.name !== 'paragraph') return false
          if ((firstChild.textContent || '').trim().length > 0) return false
          return this.editor.chain().focus().liftListItem(node.type.name).run()
        }

        return false
      },
    }
  },
})

const ListBackspaceOutdent = Extension.create({
  name: 'listBackspaceOutdent',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        if (!$from || $from.parentOffset !== 0) return false

        let itemDepth = null
        let itemTypeName = null
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type?.name === 'listItem' || node.type?.name === 'taskItem') {
            itemDepth = depth
            itemTypeName = node.type.name
            break
          }
        }
        if (!itemDepth || !itemTypeName) return false

        const itemNode = $from.node(itemDepth)
        const firstChild = itemNode.childCount > 0 ? itemNode.child(0) : null
        if (!firstChild || !firstChild.isTextblock) return false
        if ($from.depth < itemDepth + 1) return false
        if ($from.node(itemDepth + 1) !== firstChild) return false

        const listDepth = itemDepth - 1
        const listParentDepth = listDepth - 1
        if (listParentDepth <= 0) return false
        const listParent = $from.node(listParentDepth)
        if (listParent.type?.name !== 'listItem' && listParent.type?.name !== 'taskItem') {
          return false
        }

        return this.editor.chain().focus().liftListItem(itemTypeName).run()
      },
    }
  },
})

const InternalLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      onNavigateHash: null,
      getNavigateRef: null,
    }
  },
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? []
    const onNavigateHash = this.options.onNavigateHash
    const getNavigateRef = this.options.getNavigateRef

    const internalLinkPlugin = new Plugin({
      props: {
        handleClick: (_view, _pos, event) => {
          const target = event.target
          const link = target?.closest?.('a')
          const href = link?.getAttribute?.('href')
          if (!href) return false
          event.preventDefault()
          event.stopPropagation()
          if (href.startsWith('#nb=')) {
            onNavigateHash?.(href)
            return true
          }
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
    })

    return [internalLinkPlugin, ...plugins]
  },
})

const collectStoragePaths = (node, paths) => {
  if (!node) return
  if (node.type === 'image' && node.attrs?.storagePath) {
    paths.add(node.attrs.storagePath)
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectStoragePaths(child, paths))
  }
}

const applySignedUrls = (node, signedMap) => {
  if (!node) return node
  let updatedNode = node
  if (node.type === 'image' && node.attrs?.storagePath) {
    const nextSrc = signedMap[node.attrs.storagePath]
    if (nextSrc) {
      updatedNode = {
        ...node,
        attrs: {
          ...node.attrs,
          src: nextSrc,
        },
      }
    }
  }
  if (Array.isArray(updatedNode.content)) {
    return {
      ...updatedNode,
      content: updatedNode.content.map((child) => applySignedUrls(child, signedMap)),
    }
  }
  return updatedNode
}

const sanitizeContentForSave = (content) => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node
    let updatedNode = node
    if (node.type === 'image' && node.attrs?.storagePath) {
      updatedNode = {
        ...node,
        attrs: {
          ...node.attrs,
          src: null,
        },
      }
    }
    if (Array.isArray(updatedNode.content)) {
      return {
        ...updatedNode,
        content: updatedNode.content.map((child) => walk(child)),
      }
    }
    return updatedNode
  }

  return walk(normalizeContent(content))
}

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey
  const getUserId = (value) => value?.user?.id ?? null

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [notebooks, setNotebooks] = useState([])
  const [sections, setSections] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(null)
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [trackers, setTrackers] = useState([])
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [dataLoading, setDataLoading] = useState(false)
  const userId = getUserId(session)

  const pendingNavRef = useRef(null)
  const navIntentRef = useRef(null)
  const ignoreNextHashChangeRef = useRef(0)
  const hashBlockRef = useRef(null)
  const navigateRef = useRef(null)
  const savedSelectionRef = useRef(readStoredSelection())
  const saveTimerRef = useRef(null)
  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const uploadImageRef = useRef(null)
  const pasteInfoRef = useRef({
    summary: null,
    preFrom: null,
    preTo: null,
    isPmSlice: false,
    ts: 0,
    applied: false,
  })
  const pendingPasteFixRef = useRef(false)

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null
  const activeTracker = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null

  const collectBlockTargets = useCallback((state, start, end) => {
    const targets = []
    state.doc.nodesBetween(start, end, (node, pos) => {
      if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
      targets.push({ node, pos })
    })
    return targets
  }, [])

  const getListDepthAt = useCallback((state, pos) => {
    const $pos = state.doc.resolve(pos)
    let depth = 0
    for (let d = $pos.depth; d > 0; d -= 1) {
      const name = $pos.node(d).type?.name
      if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
        depth += 1
      }
    }
    return depth
  }, [])

  const getListItemTypeAt = useCallback((state, pos) => {
    const $pos = state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      const name = $pos.node(d).type?.name
      if (name === 'taskItem') return 'taskItem'
      if (name === 'listItem') return 'listItem'
    }
    return null
  }, [])

  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  useEffect(() => {
    activeTrackerRef.current = activeTracker
  }, [activeTracker])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (missingEnv) {
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setMessage(error.message)
      setSession((prev) => {
        const prevId = getUserId(prev)
        const nextId = getUserId(data.session)
        if (prevId === nextId) return prev
        return data.session
      })
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession((prev) => {
        const prevId = getUserId(prev)
        const nextId = getUserId(nextSession)
        if (prevId === nextId) return prev
        return nextSession
      })
      setLoading(false)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [missingEnv])

  const editor = useEditor(
    {
      extensions: [
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
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        InternalLink.configure({
          autolink: true,
          openOnClick: false,
          linkOnPaste: true,
          onNavigateHash: (href) => navigateRef.current?.(href),
          getNavigateRef: () => navigateRef,
          HTMLAttributes: {
            target: '_self',
            rel: 'noopener noreferrer',
          },
        }),
        LinkShortcut,
        BoldShortcut,
        ListIndentShortcut,
        ListSelectShortcut,
        ListExitOnEmpty,
        ListBackspaceOutdent,
        EnsureNodeIds,
        SecureImage.configure({ inline: false, allowBase64: false }),
        TableWithId.configure({ resizable: true }),
        TableRow,
        TableHeaderWithBackground,
        TableCellWithBackground,
        Placeholder.configure({
          placeholder: 'Start writing your tracker...',
        }),
      ],
      content: EMPTY_DOC,
      editorProps: {
        attributes: {
          class: 'editor-content',
        },
        transformPasted: (slice) => {
          pasteInfoRef.current = {
            ...pasteInfoRef.current,
            summary: summarizeSlice(slice),
          }
          return slice
        },
        handlePaste: (view, event) => {
          const html = event.clipboardData?.getData('text/html') ?? ''
          pasteInfoRef.current = {
            ...pasteInfoRef.current,
            preFrom: view.state.selection.from,
            preTo: view.state.selection.to,
            isPmSlice: html.includes('data-pm-slice'),
            ts: Date.now(),
            applied: false,
          }
          pendingPasteFixRef.current = pasteInfoRef.current.isPmSlice
          const files = event.clipboardData?.files
          if (files && files.length > 0) {
            const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
            if (imageFile) {
              event.preventDefault()
              uploadImageRef.current?.(imageFile)
              return true
            }
          }

          return false
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false
          const files = event.dataTransfer?.files
          if (!files || files.length === 0) return false
          const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
          if (!imageFile) return false
          event.preventDefault()
          uploadImageRef.current?.(imageFile)
          return true
        },
      },
    },
    [session?.user?.id],
  )

  const hydrateContentWithSignedUrls = useCallback(
    async (content) => {
      if (!session) return content
      const paths = new Set()
      collectStoragePaths(content, paths)
      if (paths.size === 0) return content

      const entries = await Promise.all(
        Array.from(paths).map(async (path) => {
          const { data, error } = await supabase.storage
            .from('tracker-images')
            .createSignedUrl(path, 60 * 60)
          if (error || !data?.signedUrl) return [path, null]
          return [path, data.signedUrl]
        }),
      )

      const signedMap = entries.reduce((acc, [path, url]) => {
        if (url) acc[path] = url
        return acc
      }, {})

      return applySignedUrls(content, signedMap)
    },
    [session],
  )

  useEffect(() => {
    if (!editor) return
    let mounted = true
    const setContent = async () => {
      const rawContent = normalizeContent(activeTracker?.content)
      const hydrated = await hydrateContentWithSignedUrls(rawContent)
      if (!mounted) return
      editor.commands.setContent(hydrated, {
        emitUpdate: false,
        parseOptions: {
          preserveWhitespace: 'full',
        },
      })
      const attemptScroll = (attempts = 0) => {
        if (!mounted) return
        const pending = pendingNavRef.current
        if (!pending?.blockId || pending.pageId !== activeTrackerId) return
        const target = document.getElementById(pending.blockId)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
          const range = document.createRange()
          range.selectNodeContents(target)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          pendingNavRef.current = null
        } else if (attempts < 10) {
          setTimeout(() => attemptScroll(attempts + 1), 50)
        } else {
          pendingNavRef.current = null
        }
      }
      requestAnimationFrame(() => attemptScroll())
    }
    setContent()
    return () => {
      mounted = false
    }
  }, [editor, activeTrackerId, hydrateContentWithSignedUrls])

  useEffect(() => {
    if (activeTracker) {
      setTitleDraft(activeTracker.title)
    } else {
      setTitleDraft('')
    }
    setSaveStatus('Saved')
  }, [activeTrackerId])

  const loadNotebooks = useCallback(async () => {
    if (!userId) return
    setMessage('')
    const { data, error } = await supabase
      .from('notebooks')
      .select('id, title, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks(data ?? [])
    const pending = pendingNavRef.current
    const saved = savedSelectionRef.current ?? readStoredSelection()
    if (pending?.notebookId && data?.some((item) => item.id === pending.notebookId)) {
      setActiveNotebookId(pending.notebookId)
    } else {
      setActiveNotebookId((prev) => {
        if (prev && data?.some((item) => item.id === prev)) return prev
        if (saved?.notebookId && data?.some((item) => item.id === saved.notebookId)) {
          return saved.notebookId
        }
        return data?.[0]?.id ?? null
      })
    }
  }, [userId])

  const loadSections = useCallback(
    async (notebookId) => {
      if (!userId || !notebookId) return
      setMessage('')
      const { data, error } = await supabase
        .from('sections')
        .select('id, title, color, sort_order, created_at, updated_at')
        .eq('notebook_id', notebookId)
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })

      if (error) {
        setMessage(error.message)
        return
      }

      setSections(data ?? [])
      const pending = pendingNavRef.current
      const saved = savedSelectionRef.current ?? readStoredSelection()
      if (pending?.sectionId && data?.some((item) => item.id === pending.sectionId)) {
        setActiveSectionId(pending.sectionId)
      } else {
        setActiveSectionId((prev) => {
          if (prev && data?.some((item) => item.id === prev)) return prev
          if (saved?.sectionId && data?.some((item) => item.id === saved.sectionId)) {
            return saved.sectionId
          }
          return data?.[0]?.id ?? null
        })
      }
    },
    [userId],
  )

  const loadTrackers = useCallback(
    async (sectionId) => {
      if (!userId || !sectionId) return
      setDataLoading(true)
      setMessage('')
      const { data, error } = await supabase
        .from('trackers')
        .select('id, title, content, created_at, updated_at, section_id, sort_order')
        .eq('section_id', sectionId)
        .order('sort_order', { ascending: true, nullsLast: true })
        .order('updated_at', { ascending: false })

      if (error) {
        setMessage(error.message)
        setDataLoading(false)
        return
      }

      setTrackers(data ?? [])
      const pending = pendingNavRef.current
      const saved = savedSelectionRef.current ?? readStoredSelection()
      if (pending?.pageId && data?.some((item) => item.id === pending.pageId)) {
        setActiveTrackerId(pending.pageId)
      } else {
        setActiveTrackerId((prev) => {
          if (prev && data?.some((item) => item.id === prev)) return prev
          if (saved?.pageId && data?.some((item) => item.id === saved.pageId)) {
            return saved.pageId
          }
          return data?.[0]?.id ?? null
        })
      }
      setDataLoading(false)
    },
    [userId],
  )

  useEffect(() => {
    if (!userId) return
    loadNotebooks()
  }, [userId, loadNotebooks])

  useEffect(() => {
    if (!activeNotebookId) {
      setSections([])
      setActiveSectionId(null)
      return
    }
    setSections([])
    setActiveSectionId(null)
    loadSections(activeNotebookId)
  }, [activeNotebookId, loadSections])

  useEffect(() => {
    if (!activeSectionId) {
      setTrackers([])
      setActiveTrackerId(null)
      return
    }
    setTrackers([])
    setActiveTrackerId(null)
    loadTrackers(activeSectionId)
  }, [activeSectionId, loadTrackers])

  const scheduleSave = useCallback(
    (nextContent, nextTitle) => {
      const tracker = activeTrackerRef.current
      if (!tracker) return

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      const title = (nextTitle ?? titleDraftRef.current)?.trim() || 'Untitled Tracker'
      const payload = {
        title,
        content: sanitizeContentForSave(nextContent),
        updated_at: new Date().toISOString(),
      }

      setSaveStatus('Saving...')

      saveTimerRef.current = setTimeout(async () => {
        const { error } = await supabase.from('trackers').update(payload).eq('id', tracker.id)

        if (error) {
          setMessage(error.message)
          setSaveStatus('Error')
          return
        }

        setTrackers((prev) =>
          prev.map((item) => (item.id === tracker.id ? { ...item, ...payload } : item)),
        )
        setSaveStatus('Saved')
      }, 2000)
    },
    [setTrackers],
  )

  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      if (!activeTrackerRef.current) return
      scheduleSave(editor.getJSON())
    }
    editor.on('update', handleUpdate)
    return () => editor.off('update', handleUpdate)
  }, [editor, scheduleSave])

  useEffect(() => {
    if (!editor) return
    const handleTransaction = ({ transaction }) => {
      const isPasteMeta =
        transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste'
      const isPending = pendingPasteFixRef.current
      if (!isPasteMeta && !isPending) return
      const info = pasteInfoRef.current
      if (!info?.isPmSlice || !info.summary?.length) {
        pendingPasteFixRef.current = false
        return
      }
      if (info.applied) return
      const { view } = editor
      const steps = transaction.mapping?.maps ?? []
      const firstStep = steps[0]
      const insertStart = firstStep ? firstStep.ranges[0] : null
      const insertOldSize = firstStep ? firstStep.ranges[1] : null
      const insertNewSize = firstStep ? firstStep.ranges[2] : null
      if (insertStart === null || insertOldSize === null || insertNewSize === null) {
        pendingPasteFixRef.current = false
        return
      }
      const mappedStart = insertStart
      const mappedEnd = insertStart + Math.max(insertNewSize, 0)
      const expectedCount = info.summary.length
      const applyFixes = () => {
        if (!view || view.isDestroyed) return
        const { state, dispatch } = view
        const summary = info.summary ?? []
        const targets = []
        state.doc.nodesBetween(mappedStart, Math.min(mappedEnd, state.doc.content.size), (node, pos) => {
          if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
          targets.push({ node, pos })
        })
        const limit = Math.min(expectedCount, summary.length, targets.length)
        const tr = state.tr
        for (let i = 0; i < limit; i += 1) {
          const expectedAlign = summary[i]?.align ?? 'left'
          const target = targets[i]
          if (!target) continue
          const nextAttrs = { ...target.node.attrs }
          if (!expectedAlign || expectedAlign === 'left') {
            if (nextAttrs.textAlign != null) delete nextAttrs.textAlign
          } else {
            nextAttrs.textAlign = expectedAlign
          }
          tr.setNodeMarkup(target.pos, undefined, nextAttrs)
        }
        if (tr.docChanged) dispatch(tr)

        let currentState = view.state
        for (let i = 0; i < limit; i += 1) {
          const expectedDepth = summary[i]?.listDepth ?? 0
          let currentTargets = []
          currentState.doc.nodesBetween(mappedStart, Math.min(mappedEnd, currentState.doc.content.size), (node, pos) => {
            if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
            currentTargets.push({ node, pos })
          })
          let currentTarget = currentTargets[i]
          if (!currentTarget) continue
          let actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
          let guard = 0
          while (actualDepth > expectedDepth && guard < 10) {
            const itemType = getListItemTypeAt(currentState, currentTarget.pos + 1)
            if (!itemType) break
            editor.chain().setTextSelection(currentTarget.pos + 1).liftListItem(itemType).run()
            currentState = editor.view.state
            currentTargets = []
            currentState.doc.nodesBetween(mappedStart, Math.min(mappedEnd, currentState.doc.content.size), (node, pos) => {
              if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
              currentTargets.push({ node, pos })
            })
            currentTarget = currentTargets[i]
            if (!currentTarget) break
            actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
            guard += 1
          }
        }
        pasteInfoRef.current = {
          summary: null,
          preFrom: null,
          preTo: null,
          isPmSlice: false,
          ts: 0,
          applied: false,
        }
        pendingPasteFixRef.current = false
      }
      pasteInfoRef.current = { ...pasteInfoRef.current, applied: true }
      setTimeout(applyFixes, 0)
    }
    editor.on('transaction', handleTransaction)
    return () => editor.off('transaction', handleTransaction)
  }, [editor, collectBlockTargets, getListDepthAt, getListItemTypeAt])

  useEffect(() => {
    if (!session) return
    if (typeof window === 'undefined') return
    const selection = {
      notebookId: activeNotebookId ?? null,
      sectionId: activeSectionId ?? null,
      pageId: activeTrackerId ?? null,
    }
    savedSelectionRef.current = selection
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  }, [session, activeNotebookId, activeSectionId, activeTrackerId])

  const handleTitleChange = (value) => {
    setTitleDraft(value)
    titleDraftRef.current = value
    if (!editor || !activeTrackerRef.current) return
    scheduleSave(editor.getJSON(), value)
  }

  const handleCreateTracker = async () => {
    if (!session || !activeSectionId) return
    setMessage('')
    const title = 'Untitled'
    const existingOrders = trackers
      .map((item) => item.sort_order)
      .filter((value) => typeof value === 'number')
    const nextSortOrder =
      existingOrders.length > 0 ? Math.min(...existingOrders) - 1 : 1

    const { data, error } = await supabase
      .from('trackers')
      .insert({
        title,
        user_id: session.user.id,
        content: EMPTY_DOC,
        section_id: activeSectionId,
        sort_order: nextSortOrder,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setTrackers((prev) => [{ ...data, sort_order: nextSortOrder }, ...prev])
    setActiveTrackerId(data.id)
  }

  const handleReorderTrackers = useCallback(
    async (nextTrackers) => {
      if (!userId) return
      const reordered = nextTrackers.map((item, index) => ({
        ...item,
        sort_order: index + 1,
      }))
      setTrackers(reordered)
      const updates = reordered.map((item) =>
        supabase.from('trackers').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
      }
    },
    [userId],
  )

  const handleDeleteTracker = async () => {
    const tracker = activeTrackerRef.current
    if (!tracker) return
    const confirmDelete = window.confirm(`Delete "${tracker.title}"? This cannot be undone.`)
    if (!confirmDelete) return

    const { error } = await supabase.from('trackers').delete().eq('id', tracker.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextTrackers = trackers.filter((item) => item.id !== tracker.id)
    setTrackers(nextTrackers)
    setActiveTrackerId((prev) => (prev === tracker.id ? nextTrackers[0]?.id ?? null : prev))
  }

  const handleCreateNotebook = async () => {
    if (!session) return
    const title = window.prompt('Notebook name', 'My Notebook')
    if (!title) return
    const { data, error } = await supabase
      .from('notebooks')
      .insert({
        title: title.trim(),
        user_id: session.user.id,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks((prev) => [...prev, data])
    setActiveNotebookId(data.id)
  }

  const handleRenameNotebook = async () => {
    if (!activeNotebook) return
    const nextTitle = window.prompt('Rename notebook', activeNotebook.title)
    if (!nextTitle) return
    const { error } = await supabase
      .from('notebooks')
      .update({ title: nextTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', activeNotebook.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks((prev) =>
      prev.map((item) => (item.id === activeNotebook.id ? { ...item, title: nextTitle.trim() } : item)),
    )
  }

  const handleDeleteNotebook = async () => {
    if (!activeNotebook) return
    const confirmDelete = window.confirm(
      `Delete "${activeNotebook.title}"? This will delete all its sections and pages.`,
    )
    if (!confirmDelete) return

    const { error } = await supabase.from('notebooks').delete().eq('id', activeNotebook.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextNotebooks = notebooks.filter((item) => item.id !== activeNotebook.id)
    setNotebooks(nextNotebooks)
    setActiveNotebookId(nextNotebooks[0]?.id ?? null)
  }

  const colorPalette = ['#e0f2fe', '#ede9fe', '#fce7f3', '#fef9c3', '#dcfce7', '#ffe4e6']

  const handleCreateSection = async () => {
    if (!session || !activeNotebookId) return
    const title = window.prompt('Section name', 'New Section')
    if (!title) return
    const color = colorPalette[sections.length % colorPalette.length]
    const { data, error } = await supabase
      .from('sections')
      .insert({
        title: title.trim(),
        user_id: session.user.id,
        notebook_id: activeNotebookId,
        color,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setSections((prev) => [...prev, data])
    setActiveSectionId(data.id)
  }

  const handleRenameSection = async (section) => {
    if (!section) return
    const nextTitle = window.prompt('Rename section', section.title)
    if (!nextTitle) return
    const { error } = await supabase
      .from('sections')
      .update({ title: nextTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setSections((prev) =>
      prev.map((item) => (item.id === section.id ? { ...item, title: nextTitle.trim() } : item)),
    )
  }

  const handleDeleteSection = async (section) => {
    if (!section) return
    const confirmDelete = window.confirm(
      `Delete "${section.title}"? This will delete all pages in this section.`,
    )
    if (!confirmDelete) return

    const { error } = await supabase.from('sections').delete().eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextSections = sections.filter((item) => item.id !== section.id)
    setSections(nextSections)
    setActiveSectionId((prev) => (prev === section.id ? nextSections[0]?.id ?? null : prev))
  }

  const handleSignIn = async (event) => {
    event.preventDefault()
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

  const handleSignOut = async () => {
    setMessage('')
    await supabase.auth.signOut()
    setTrackers([])
    setActiveTrackerId(null)
    setSections([])
    setActiveSectionId(null)
    setNotebooks([])
    setActiveNotebookId(null)
    setTitleDraft('')
    pendingNavRef.current = null
  }

  const uploadImageAndInsert = useCallback(
    async (file) => {
      if (!session || !editor) return
      setMessage('')

      const fileExt = file.name.split('.').pop()
      const fileName = `${crypto.randomUUID?.() ?? Date.now()}.${fileExt}`
      const filePath = `${session.user.id}/${fileName}`

      const { data, error } = await supabase.storage
        .from('tracker-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (error) {
        setMessage(error.message)
        return
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from('tracker-images')
        .createSignedUrl(data.path, 60 * 60)

      if (signedError || !signedData?.signedUrl) {
        setMessage(signedError?.message ?? 'Unable to create signed image URL.')
        return
      }

      editor
        .chain()
        .focus()
        .setImage({ src: signedData.signedUrl, alt: file.name, storagePath: data.path })
        .run()
    },
    [session, editor],
  )

  useEffect(() => {
    uploadImageRef.current = uploadImageAndInsert
  }, [uploadImageAndInsert])

  const buildHash = useCallback(({ notebookId, sectionId, pageId, blockId }) => {
    if (!notebookId) return ''
    const params = new URLSearchParams()
    params.set('nb', notebookId)
    if (sectionId) params.set('sec', sectionId)
    if (pageId) params.set('pg', pageId)
    if (blockId) params.set('block', blockId)
    return `#${params.toString()}`
  }, [])

  const updateHash = useCallback((hash, mode = 'replace') => {
    if (!hash || !hash.startsWith('#')) return
    if (window.location.hash === hash) return
    if (mode === 'push') {
      ignoreNextHashChangeRef.current += 1
      window.location.hash = hash
      return
    }
    window.history.replaceState(null, '', hash)
  }, [])

  const parseDeepLink = useCallback((hash) => {
    if (!hash || !hash.startsWith('#nb=')) return null
    const params = new URLSearchParams(hash.slice(1))
    const notebookId = params.get('nb')
    if (!notebookId) return null
    return {
      notebookId,
      sectionId: params.get('sec'),
      pageId: params.get('pg'),
      blockId: params.get('block'),
    }
  }, [])

  const navigateToHash = useCallback(
    (hash) => {
      const parsed = typeof hash === 'string' ? parseDeepLink(hash) : hash
      if (!parsed?.notebookId) return
      if (parsed.pageId && parsed.blockId) {
        hashBlockRef.current = { pageId: parsed.pageId, blockId: parsed.blockId }
      } else {
        hashBlockRef.current = null
      }
      pendingNavRef.current = parsed
      if (parsed.pageId && parsed.pageId === activeTrackerId) {
        requestAnimationFrame(() => {
          if (parsed.blockId) {
            const target = document.getElementById(parsed.blockId)
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' })
              const range = document.createRange()
              range.selectNodeContents(target)
              const sel = window.getSelection()
              sel.removeAllRanges()
              sel.addRange(range)
            }
          }
          pendingNavRef.current = null
        })
        return
      }
      if (parsed.notebookId === activeNotebookId) {
        if (parsed.sectionId && parsed.sectionId !== activeSectionId) {
          setActiveSectionId(parsed.sectionId)
          return
        }
        if (parsed.pageId && parsed.pageId !== activeTrackerId) {
          setActiveTrackerId(parsed.pageId)
          return
        }
        pendingNavRef.current = null
        return
      }
      if (notebooks.some((item) => item.id === parsed.notebookId)) {
        setActiveNotebookId(parsed.notebookId)
      }
    },
    [
      parseDeepLink,
      notebooks,
      activeTrackerId,
      activeNotebookId,
      activeSectionId,
    ],
  )

  const handleInternalHashNavigate = useCallback(
    (href) => {
      if (!href || !href.startsWith('#nb=')) return
      if (window.location.hash === href) {
        navigateToHash(href)
        return
      }
      window.location.hash = href
    },
    [navigateToHash],
  )

  useEffect(() => {
    navigateRef.current = handleInternalHashNavigate
  }, [handleInternalHashNavigate])

  useEffect(() => {
    if (!activeNotebookId) return
    const blockInfo = hashBlockRef.current
    if (blockInfo && blockInfo.pageId !== activeTrackerId) {
      const pending = pendingNavRef.current
      if (pending?.pageId === blockInfo.pageId) return
      hashBlockRef.current = null
    }
    const blockId =
      blockInfo && blockInfo.pageId === activeTrackerId ? blockInfo.blockId : null
    const hash = buildHash({
      notebookId: activeNotebookId,
      sectionId: activeSectionId,
      pageId: activeTrackerId,
      blockId,
    })
    if (!hash) return
    const mode = navIntentRef.current === 'push' ? 'push' : 'replace'
    navIntentRef.current = null
    updateHash(hash, mode)
  }, [
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    buildHash,
    updateHash,
  ])

  useEffect(() => {
    if (!session) return
    const initial = parseDeepLink(window.location.hash)
    if (initial) {
      pendingNavRef.current = initial
      if (initial.pageId && initial.blockId) {
        hashBlockRef.current = { pageId: initial.pageId, blockId: initial.blockId }
      } else {
        hashBlockRef.current = null
      }
      if (notebooks.some((item) => item.id === initial.notebookId)) {
        setActiveNotebookId(initial.notebookId)
      }
    }
  }, [session, parseDeepLink, notebooks])

  useEffect(() => {
    const handleHashChange = () => {
      if (ignoreNextHashChangeRef.current > 0) {
        ignoreNextHashChangeRef.current -= 1
        return
      }
      navigateToHash(window.location.hash)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [navigateToHash])

  if (missingEnv) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">
          <p>Missing Supabase environment variables.</p>
          <p>
            Set these in a <code>.env.local</code> file, then restart the dev server:
          </p>
          <ul>
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
          </ul>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app app-auth">
        <h1>Life Tracker</h1>
        <div className="card">
          <h2>Sign in</h2>
          <form onSubmit={handleSignIn} className="form">
            <label className="label">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="label">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
              />
            </label>
            <div className="actions">
              <button type="submit">Sign in</button>
            </div>
          </form>
          <p className="subtle">Need access? Contact the admin.</p>
          {message && <p className="message">{message}</p>}
        </div>
      </div>
    )
  }

  if (notebooks.length === 0) {
    return (
      <div className="app">
        <header className="topbar">
          <div>
            <h1>Life Tracker</h1>
            <p className="subtle">Signed in as {session.user.email}</p>
          </div>
          <button className="secondary" onClick={handleSignOut}>
            Log out
          </button>
        </header>
        <div className="welcome">
          <div className="card">
            <h2>Create your first notebook</h2>
            <p className="subtle">
              Notebooks group your trackers. Create one to start organizing your sections and pages.
            </p>
            <button onClick={handleCreateNotebook}>New notebook</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <h1>Life Tracker</h1>
            <p className="subtle">Signed in as {session.user.email}</p>
          </div>
          <div className="notebook-switcher">
            <label className="subtle">Notebook</label>
            <select
              value={activeNotebookId ?? ''}
              onChange={(event) => {
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                pendingNavRef.current = null
                setActiveNotebookId(event.target.value)
              }}
            >
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.title}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={handleCreateNotebook}>
              New
            </button>
            <button className="ghost" onClick={handleRenameNotebook} disabled={!activeNotebook}>
              Rename
            </button>
            <button className="ghost" onClick={handleDeleteNotebook} disabled={!activeNotebook}>
              Delete
            </button>
          </div>
        </div>
          <button className="secondary" onClick={handleSignOut}>
            Log out
          </button>
        </header>

      <div className="section-tabs">
        {sections.map((section) => (
          <div
            key={section.id}
            role="button"
            tabIndex={0}
            className={`section-tab ${section.id === activeSectionId ? 'active' : ''}`}
            style={{ backgroundColor: section.color || '#eef2ff' }}
            onClick={() => {
              navIntentRef.current = 'push'
              hashBlockRef.current = null
              pendingNavRef.current = null
              setActiveSectionId(section.id)
            }}
            onDoubleClick={() => handleRenameSection(section)}
            onContextMenu={(event) => {
              event.preventDefault()
              handleRenameSection(section)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                pendingNavRef.current = null
                setActiveSectionId(section.id)
              }
            }}
          >
            <span>{section.title}</span>
            <button
              type="button"
              className="tab-delete"
              onClick={(event) => {
                event.stopPropagation()
                handleDeleteSection(section)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="section-add" onClick={handleCreateSection} disabled={!activeNotebookId}>
          +
        </button>
      </div>

      <div className="workspace">
        <EditorPanel
          editor={editor}
          title={titleDraft}
          onTitleChange={handleTitleChange}
          onDelete={handleDeleteTracker}
          saveStatus={saveStatus}
          onImageUpload={uploadImageAndInsert}
          hasTracker={!!activeTracker}
          message={message}
          notebookId={activeNotebookId}
          sectionId={activeSectionId}
          trackerId={activeTrackerId}
          onNavigateHash={handleInternalHashNavigate}
          allTrackers={trackers}
        />
        <Sidebar
          trackers={trackers}
          activeId={activeTrackerId}
          onSelect={(id) => {
            navIntentRef.current = 'push'
            hashBlockRef.current = null
            pendingNavRef.current = null
            setActiveTrackerId(id)
          }}
          onCreate={handleCreateTracker}
          onReorder={handleReorderTrackers}
          loading={dataLoading}
          disabled={!activeSectionId}
        />
      </div>
    </div>
  )
}

export default App
