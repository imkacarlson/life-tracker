import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import { TableMap } from '@tiptap/pm/tables'
import { supabase } from '../lib/supabase'
import { findInDocPluginKey } from '../extensions/findInDoc'
import { serializeDocToText } from '../lib/serializeDoc'

function EditorPanel({
  editor,
  title,
  onTitleChange,
  onDelete,
  saveStatus,
  onImageUpload,
  hasTracker,
  message,
  notebookId,
  sectionId,
  trackerId,
  onNavigateHash,
  allTrackers,
  trackerSourcePage = null,
  onSetTrackerPage = null,
  trackerPageSaving = false,
  userId,
  titleReadOnly = false,
  showDelete = true,
  headerActions = null,
  showAiDaily = true,
  showAiInsert = true,
}) {
  const fileInputRef = useRef(null)
  const tableButtonRef = useRef(null)
  const tablePickerRef = useRef(null)
  const highlightButtonRef = useRef(null)
  const highlightPickerRef = useRef(null)
  const shadingButtonRef = useRef(null)
  const shadingPickerRef = useRef(null)
  const shadingInputRef = useRef(null)
  const aiDailyButtonRef = useRef(null)
  const aiDailyPickerRef = useRef(null)
  const contextMenuRef = useRef(null)
  const submenuRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const findInputRef = useRef(null)
  const aiInsertInputRef = useRef(null)
  const [aiDailyPickerOpen, setAiDailyPickerOpen] = useState(false)
  const [aiDailyDate, setAiDailyDate] = useState(new Date())
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 })
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false)
  const [highlightColor, setHighlightColor] = useState('#fef08a')
  const [shadingPickerOpen, setShadingPickerOpen] = useState(false)
  const [shadingColor, setShadingColor] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiInsertOpen, setAiInsertOpen] = useState(false)
  const [aiInsertLoading, setAiInsertLoading] = useState(false)
  const [aiInsertText, setAiInsertText] = useState('')
  const [inTable, setInTable] = useState(false)
  const [contextMenu, setContextMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    blockId: null,
    inTable: false,
  })
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [submenuDirection, setSubmenuDirection] = useState('right')
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findStatus, setFindStatus] = useState({ query: '', matches: [], index: -1 })
  const gridSize = 5

  useEffect(() => {
    if (aiDailyPickerOpen) {
      setAiDailyDate(new Date())
    }
  }, [aiDailyPickerOpen])

  useEffect(() => {
    if (!aiInsertOpen) return
    requestAnimationFrame(() => {
      aiInsertInputRef.current?.focus()
    })
  }, [aiInsertOpen])

  const handleAiDailyPrevDay = () => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() - 1)
      return next
    })
  }

  const handleAiDailyNextDay = () => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + 1)
      return next
    })
  }

  const handleAiDailyDateChange = (dateString) => {
    const parsed = new Date(dateString + 'T00:00:00')
    if (!isNaN(parsed.getTime())) {
      setAiDailyDate(parsed)
    }
  }

  const handlePickImage = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      onImageUpload?.(file)
    }
    event.target.value = ''
  }

  const handleSetLink = () => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Paste a link URL', previousUrl || '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const handleSetTextAlign = (alignment) => {
    editor?.chain().focus().setTextAlign(alignment).run()
  }

  const openFind = useCallback(() => {
    if (!editor || !hasTracker) return
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [editor, hasTracker])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    editor?.commands?.clearFind?.()
  }, [editor])

  const handleFindQueryChange = (value) => {
    setFindQuery(value)
    editor?.commands?.setFindQuery?.(value)
    // Don't focus editor here - it steals focus from the search input
  }

  const scrollMatchIntoView = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      const { view } = editor
      const { from } = view.state.selection
      const coords = view.coordsAtPos(from)
      const toolbarHeight = 100 // Approximate height of toolbar + find bar
      const bottomPadding = 50 // Padding from bottom of viewport

      // If match is hidden behind toolbar (too high)
      if (coords.top < toolbarHeight) {
        const scrollAmount = toolbarHeight - coords.top + 20
        window.scrollBy({ top: -scrollAmount, behavior: 'instant' })
      }
      // If match is below the visible viewport (too low)
      else if (coords.bottom > window.innerHeight - bottomPadding) {
        const scrollAmount = coords.bottom - window.innerHeight + bottomPadding + 20
        window.scrollBy({ top: scrollAmount, behavior: 'instant' })
      }
    })
  }, [editor])

  const handleFindNext = () => {
    editor?.commands?.findNext?.()
    scrollMatchIntoView()
  }

  const handleFindPrev = () => {
    editor?.commands?.findPrev?.()
    scrollMatchIntoView()
  }

  const handleExportText = () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
    const doc = editor.getJSON()
    const lines = []

    const serializeInline = (content) => {
      if (!content) return ''
      return content
        .map((node) => {
          if (node.type === 'text') {
            let text = node.text || ''
            const marks = node.marks || []
            const hasBold = marks.some((m) => m.type === 'bold')
            const hasItalic = marks.some((m) => m.type === 'italic')
            const hasStrike = marks.some((m) => m.type === 'strike')
            const hasHighlight = marks.some((m) => m.type === 'highlight')
            if (hasBold) text = `**${text}**`
            if (hasItalic) text = `_${text}_`
            if (hasStrike) text = `~~${text}~~`
            if (hasHighlight) text = `[${text}]`
            return text
          }
          if (node.type === 'hardBreak') return '\n'
          if (node.type === 'image') return '[image]'
          return ''
        })
        .join('')
    }

    const serializeNode = (node, indent = 0, listIndex = null) => {
      const prefix = '  '.repeat(indent)

      switch (node.type) {
        case 'doc':
          node.content?.forEach((child) => serializeNode(child, indent))
          break

        case 'paragraph': {
          const text = serializeInline(node.content)
          lines.push(prefix + text)
          break
        }

        case 'heading': {
          const text = serializeInline(node.content)
          if (lines.length > 0) lines.push('')
          lines.push(prefix + text.toUpperCase())
          lines.push('')
          break
        }

        case 'bulletList':
          node.content?.forEach((child) => serializeNode(child, indent, 'bullet'))
          break

        case 'orderedList': {
          let counter = 1
          node.content?.forEach((child) => {
            serializeNode(child, indent, counter)
            counter += 1
          })
          break
        }

        case 'taskList':
          node.content?.forEach((child) => serializeNode(child, indent, 'task'))
          break

        case 'listItem':
        case 'taskItem': {
          const marker =
            listIndex === 'bullet'
              ? '- '
              : listIndex === 'task'
                ? node.attrs?.checked
                  ? '[x] '
                  : '[ ] '
                : `${listIndex}. `
          const children = node.content || []
          children.forEach((child, i) => {
            if (i === 0 && child.type === 'paragraph') {
              lines.push(prefix + marker + serializeInline(child.content))
            } else {
              serializeNode(child, indent + 1)
            }
          })
          break
        }

        case 'table':
          node.content?.forEach((row, rowIdx) => {
            row.content?.forEach((cell) => {
              cell.content?.forEach((child) => serializeNode(child, indent))
            })
            if (rowIdx < (node.content?.length || 0) - 1) {
              const cellText =
                row.content
                  ?.map((c) => c.content?.map((n) => serializeInline(n.content)).join(''))
                  .join('') || ''
              if (cellText.trim()) lines.push(prefix + '---')
            }
          })
          break

        case 'tableRow':
        case 'tableCell':
        case 'tableHeader':
          node.content?.forEach((child) => serializeNode(child, indent))
          break

        case 'blockquote':
          node.content?.forEach((child) => serializeNode(child, indent + 1))
          break

        case 'codeBlock': {
          lines.push(prefix + '```')
          const text = node.content?.map((n) => n.text || '').join('') || ''
          text.split('\n').forEach((line) => lines.push(prefix + line))
          lines.push(prefix + '```')
          break
        }

        case 'horizontalRule':
          lines.push(prefix + '---')
          break

        default:
          if (node.content) {
            node.content.forEach((child) => serializeNode(child, indent))
          }
          break
      }
    }

    serializeNode(doc)

    const text = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeTitle}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const normalizeTemplateContent = (content) => {
    if (content && typeof content === 'object' && content.type) return content
    return { type: 'doc', content: [] }
  }

  const hasMeaningfulTemplate = (doc) => {
    const content = Array.isArray(doc?.content) ? doc.content : []
    if (content.length === 0) return false
    if (content.length === 1 && content[0]?.type === 'paragraph') {
      const text = (content[0].content || [])
        .map((node) => node.text || '')
        .join('')
        .trim()
      const hasNonText = (content[0].content || []).some(
        (node) => node.type && node.type !== 'text' && node.type !== 'hardBreak',
      )
      return Boolean(text || hasNonText)
    }
    return true
  }

  const isWhitespaceText = (value) => !value || value.trim().length === 0

  const isEmptyParagraphNode = (node) => {
    if (!node || node.type !== 'paragraph') return false
    const content = Array.isArray(node.content) ? node.content : []
    if (content.length === 0) return true
    return content.every((child) => {
      if (child.type === 'hardBreak') return true
      if (child.type === 'text') return isWhitespaceText(child.text || '')
      return false
    })
  }

  const trimTrailingEmptyParagraphs = (nodes) => {
    if (!Array.isArray(nodes)) return []
    const trimmed = [...nodes]
    while (trimmed.length > 0 && isEmptyParagraphNode(trimmed[trimmed.length - 1])) {
      trimmed.pop()
    }
    return trimmed
  }

  const getMergeableTemplateList = (nodes) => {
    const trimmed = trimTrailingEmptyParagraphs(nodes)
    if (trimmed.length === 0) return null
    const lastIndex = trimmed.length - 1
    const lastNode = trimmed[lastIndex]
    if (lastNode?.type !== 'bulletList') return null
    return {
      prefix: trimmed.slice(0, lastIndex),
      listNode: lastNode,
    }
  }

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

  const hydrateContentWithSignedUrls = async (content) => {
    const doc = normalizeTemplateContent(content)
    const paths = new Set()
    collectStoragePaths(doc, paths)
    if (paths.size === 0) return doc

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

    return applySignedUrls(doc, signedMap)
  }

  const loadDailyTemplateNodes = async () => {
    if (!userId) return []
    const { data, error } = await supabase
      .from('settings')
      .select('daily_template_content')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('Failed to load daily template:', error)
      return []
    }
    const doc = normalizeTemplateContent(data?.daily_template_content)
    if (!hasMeaningfulTemplate(doc)) return []
    const hydrated = await hydrateContentWithSignedUrls(doc)
    const nodes = Array.isArray(hydrated.content) ? hydrated.content : []
    return JSON.parse(JSON.stringify(nodes))
  }

  const createNodeId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)

  const REVIEW_HIGHLIGHT_COLOR = '#fef08a'

  const makeHighlightedTextNode = (text) => ({
    type: 'text',
    text,
    marks: [{ type: 'highlight', attrs: { color: REVIEW_HIGHLIGHT_COLOR } }],
  })

  const buildAiInsertContent = (format, items) => {
    const createdAt = new Date().toISOString()

    if (format === 'task_list') {
      return [
        {
          type: 'taskList',
          attrs: { id: createNodeId(), created_at: createdAt },
          content: items.map((item) => ({
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                attrs: { id: createNodeId(), created_at: createdAt },
                content: [makeHighlightedTextNode(item)],
              },
            ],
          })),
        },
      ]
    }

    if (format === 'paragraphs') {
      return items.map((item) => ({
        type: 'paragraph',
        attrs: { id: createNodeId(), created_at: createdAt },
        content: [makeHighlightedTextNode(item)],
      }))
    }

    return [
      {
        type: 'bulletList',
        attrs: { id: createNodeId(), created_at: createdAt },
        content: items.map((item) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: createNodeId(), created_at: createdAt },
              content: [makeHighlightedTextNode(item)],
            },
          ],
        })),
      },
    ]
  }

  const findTargetBlockMatch = (targetBlockId) => {
    if (!editor || !targetBlockId) return null
    let match = null
    editor.state.doc.descendants((node, pos) => {
      if (node?.attrs?.id === targetBlockId) {
        match = { node, pos }
        return false
      }
      return true
    })
    return match
  }

  const resolveInsertPosCandidatesFromTargetMatch = (targetMatch) => {
    if (!editor || !targetMatch?.node || targetMatch.pos === null || targetMatch.pos === undefined) {
      return []
    }

    const targetPos = targetMatch.pos
    const targetNode = targetMatch.node

    const docSize = editor.state.doc.content.size
    const clampPos = (value) => Math.max(0, Math.min(value, docSize))
    const candidates = []
    const seen = new Set()

    const addCandidate = (value) => {
      const nextValue = clampPos(value)
      if (seen.has(nextValue)) return
      seen.add(nextValue)
      candidates.push(nextValue)
    }

    // Prefer placing content exactly after the matched block node.
    addCandidate(targetPos + targetNode.nodeSize)

    // Fallback to parent nodes, but avoid table structure boundaries (they can split tables).
    const insidePos = clampPos(targetPos + 1)
    const resolved = editor.state.doc.resolve(insidePos)
    if (resolved.depth < 1) return candidates

    const blockedTypes = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])
    for (let depth = resolved.depth; depth >= 1; depth -= 1) {
      const ancestor = resolved.node(depth)
      if (blockedTypes.has(ancestor.type?.name)) continue
      addCandidate(resolved.after(depth))
    }

    return candidates
  }

  const resolveListInsertPlan = (targetMatch, insertedContent) => {
    if (!editor || !targetMatch?.node || targetMatch.pos === null || targetMatch.pos === undefined) {
      return null
    }
    if (!Array.isArray(insertedContent) || insertedContent.length !== 1) return null

    const wrapper = insertedContent[0]
    if (!wrapper || (wrapper.type !== 'bulletList' && wrapper.type !== 'taskList')) {
      return null
    }

    const items = Array.isArray(wrapper.content) ? wrapper.content : []
    if (items.length === 0) return null

    const listType = wrapper.type
    const itemType = listType === 'taskList' ? 'taskItem' : 'listItem'
    const docSize = editor.state.doc.content.size
    const clampPos = (value) => Math.max(0, Math.min(value, docSize))
    const insidePos = clampPos(targetMatch.pos + 1)
    const resolved = editor.state.doc.resolve(insidePos)

    let itemDepth = null
    let listDepth = null
    for (let depth = resolved.depth; depth >= 1; depth -= 1) {
      const typeName = resolved.node(depth).type?.name
      if (itemDepth === null && typeName === itemType) {
        itemDepth = depth
      }
      if (listDepth === null && typeName === listType) {
        listDepth = depth
      }
    }

    if (itemDepth !== null && listDepth === itemDepth - 1) {
      return {
        pos: clampPos(resolved.after(itemDepth)),
        content: items,
      }
    }

    if (listDepth !== null) {
      return {
        pos: clampPos(resolved.end(listDepth)),
        content: items,
      }
    }

    const parent = resolved.parent
    const index = resolved.index()
    const nextNode = parent.child(index + 1)
    if (nextNode?.type?.name === listType) {
      const nextNodePos = clampPos(targetMatch.pos + targetMatch.node.nodeSize)
      return {
        pos: clampPos(nextNodePos + 1),
        content: items,
      }
    }

    const prevNode = index > 0 ? parent.child(index - 1) : null
    if (prevNode?.type?.name === listType) {
      const prevNodePos = clampPos(targetMatch.pos - prevNode.nodeSize)
      return {
        pos: clampPos(prevNodePos + prevNode.nodeSize - 1),
        content: items,
      }
    }

    return null
  }

  const isTopUncategorizedHeader = (node) => {
    if (!node || node.type?.name !== 'paragraph') return false
    const children = []
    node.content?.forEach((child) => children.push(child))
    const text = children
      .filter((child) => child.type?.name === 'text')
      .map((child) => child.text || '')
      .join('')
      .trim()
      .toLowerCase()
    if (text !== 'uncategorized') return false

    return children.some((child) =>
      (child.marks || []).some((mark) => mark.type?.name === 'bold'),
    )
  }

  const buildUncategorizedHeader = () => {
    const createdAt = new Date().toISOString()
    return {
      type: 'paragraph',
      attrs: { id: createNodeId(), created_at: createdAt },
      content: [{ type: 'text', text: 'Uncategorized', marks: [{ type: 'bold' }] }],
    }
  }

  const resolveFallbackInsertPos = () => {
    if (!editor) return 0
    const firstNode = editor.state.doc.firstChild
    if (isTopUncategorizedHeader(firstNode)) {
      return firstNode.nodeSize
    }
    const header = buildUncategorizedHeader()
    const headerNodeSize = editor.schema.nodeFromJSON(header).nodeSize
    editor.chain().focus().insertContentAt(0, header).run()
    return headerNodeSize
  }

  const normalizeAiInsertResponse = (data) => {
    const targetBlockId =
      typeof data?.targetBlockId === 'string' && data.targetBlockId.trim()
        ? data.targetBlockId.trim()
        : null
    const items = Array.isArray(data?.items)
      ? data.items.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    if (!items.length) {
      throw new Error('AI Insert returned no content to insert.')
    }

    const allowedFormats = new Set(['bullet_list', 'task_list', 'paragraphs'])
    const format = allowedFormats.has(data?.format) ? data.format : 'bullet_list'

    return { targetBlockId, format, items }
  }

  const scrollInsertedContentIntoView = (insertedBlockId) => {
    if (!insertedBlockId) return
    requestAnimationFrame(() => {
      const insertedElement = document.getElementById(insertedBlockId)
      if (!insertedElement) return
      insertedElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const handleAiInsertSubmit = async () => {
    if (!editor || !hasTracker || aiInsertLoading) return
    const pastedText = aiInsertText.trim()
    if (!pastedText) {
      alert('Paste content before using AI Insert.')
      return
    }

    setAiInsertLoading(true)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'
      const pageText = serializeDocToText(editor.getJSON())

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('You must be logged in to use AI Insert')
      }

      const { data, error } = await supabase.functions.invoke('ai-insert', {
        body: {
          provider,
          model,
          pastedText,
          pageTitle: title?.trim() || 'Untitled',
          pageText,
          pageId: trackerId,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (error) throw error

      const { targetBlockId, format, items } = normalizeAiInsertResponse(data)
      const insertedContent = buildAiInsertContent(format, items)
      const firstInsertedId = insertedContent[0]?.attrs?.id ?? null

      let inserted = false
      const targetMatch = findTargetBlockMatch(targetBlockId)
      const listInsertPlan = resolveListInsertPlan(targetMatch, insertedContent)
      if (listInsertPlan) {
        inserted = editor
          .chain()
          .focus()
          .insertContentAt(listInsertPlan.pos, listInsertPlan.content)
          .run()
      }

      const candidatePositions = resolveInsertPosCandidatesFromTargetMatch(targetMatch)
      for (const candidatePos of candidatePositions) {
        if (inserted) break
        if (editor.chain().focus().insertContentAt(candidatePos, insertedContent).run()) {
          inserted = true
          break
        }
      }

      if (!inserted) {
        const fallbackPos = resolveFallbackInsertPos()
        inserted = editor.chain().focus().insertContentAt(fallbackPos, insertedContent).run()
      }

      if (!inserted) {
        throw new Error('AI Insert could not find a valid insertion point.')
      }

      scrollInsertedContentIntoView(firstInsertedId)
      setAiInsertOpen(false)
      setAiInsertText('')
    } catch (err) {
      console.error('AI insert failed:', err)
      alert('Failed to insert content: ' + (err.message || String(err)))
    } finally {
      setAiInsertLoading(false)
    }
  }

  const handleGenerateToday = async () => {
    if (!editor || aiLoading || aiInsertLoading) return
    setAiLoading(true)
    setAiDailyPickerOpen(false)
    try {
      const provider = localStorage.getItem('ai-provider') || 'anthropic'
      const model = localStorage.getItem('ai-model') || 'claude-sonnet-4-20250514'
      const selectedDate = aiDailyPickerOpen ? aiDailyDate : new Date()
      const today = selectedDate.toLocaleDateString('en-CA')
      const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' })

      const sourceTrackerPage =
        trackerSourcePage ?? (allTrackers || []).find((page) => page.is_tracker_page) ?? null
      if (!sourceTrackerPage) {
        alert('Set a tracker page first (Pages sidebar > Set tracker).')
        return
      }

      const trackerPages = [
        {
          title: sourceTrackerPage.title,
          pageId: sourceTrackerPage.id,
          content: sourceTrackerPage.content || { type: 'doc', content: [] },
        },
      ]
      const trackerPagesForModel = trackerPages.map((page) => ({
        title: page.title,
        pageId: page.pageId,
        content: page.content,
      }))

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('You must be logged in to use AI Daily')
      }

      const { data, error } = await supabase.functions.invoke('generate-daily', {
        body: { provider, model, trackerPages: trackerPagesForModel, today, dayOfWeek },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (error) throw error
      const asapTasks = Array.isArray(data?.asap)
        ? data.asap
        : Array.isArray(data?.tasks)
          ? data.tasks
          : []
      const fyiTasks = Array.isArray(data?.fyi) ? data.fyi : []
      const staleTasks = Array.isArray(data?.stale) ? data.stale : []
      let templateNodes = []
      try {
        templateNodes = await loadDailyTemplateNodes()
      } catch (err) {
        console.error('Failed to load daily template:', err)
        templateNodes = []
      }
      if (asapTasks.length === 0 && fyiTasks.length === 0 && staleTasks.length === 0 && templateNodes.length === 0) {
        alert('No tasks generated. Check your tracker pages have content.')
        return
      }

      const heading = {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          {
            type: 'text',
            text: selectedDate.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            }),
          },
        ],
      }
      const buildListItems = (tasks) =>
        tasks.map((task) => {
          const content = [{ type: 'text', text: task.task }]
          if (task.block_ids?.length) {
            task.block_ids.forEach((blockId, i) => {
              const hash = `#nb=${notebookId}&sec=${sectionId}&pg=${sourceTrackerPage.id}&block=${blockId}`
              content.push({ type: 'text', text: ' ' })
              content.push({
                type: 'text',
                text: `[${i + 1}]`,
                marks: [{ type: 'link', attrs: { href: hash, target: '_self' } }],
              })
            })
          }
          return { type: 'listItem', content: [{ type: 'paragraph', content }] }
        })

      const makeRow = (label, tasks, extraNodes = []) => {
        const items = buildListItems(tasks)
        const content = [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: label, marks: [{ type: 'bold' }] }],
          },
        ]

        if (extraNodes.length) {
          const mergeInfo = getMergeableTemplateList(extraNodes)
          if (mergeInfo) {
            const mergedList = {
              ...mergeInfo.listNode,
              content: [...(mergeInfo.listNode.content || []), ...items],
            }
            content.push(...mergeInfo.prefix, mergedList)
            return {
              type: 'tableRow',
              content: [{ type: 'tableCell', content }],
            }
          }
          content.push(...extraNodes)
        }

        const listContent = items.length
          ? items
          : [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '...' }],
                  },
                ],
              },
            ]
        content.push({ type: 'bulletList', content: listContent })
        return {
          type: 'tableRow',
          content: [{ type: 'tableCell', content }],
        }
      }

      const table = {
        type: 'table',
        content: [
          makeRow('ASAP', asapTasks, templateNodes),
          makeRow('FYI', fyiTasks),
          makeRow('STALE', staleTasks),
        ],
      }

      const insertContent = [heading]
      if (data?.warning) {
        insertContent.push({
          type: 'paragraph',
          content: [{ type: 'text', text: data.warning, marks: [{ type: 'italic' }] }],
        })
      }
      insertContent.push(table)
      if (!editor.state.selection.empty) {
        editor.commands.setTextSelection(editor.state.selection.to)
      }
      editor.chain().focus().insertContent(insertContent).run()
    } catch (err) {
      console.error('AI generation failed:', err)
      alert('Failed to generate tasks: ' + (err.message || String(err)))
    } finally {
      setAiLoading(false)
    }
  }

  const openContextMenu = useCallback((next) => {
    setTablePickerOpen(false)
    setContextMenu({
      open: true,
      x: next.x,
      y: next.y,
      blockId: next.blockId ?? null,
      inTable: next.inTable ?? false,
    })
    setSubmenuOpen(false)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev))
    setSubmenuOpen(false)
  }, [])

  const closeTablePicker = useCallback(() => {
    setTablePickerOpen(false)
  }, [])

  const closeHighlightPicker = useCallback(() => {
    setHighlightPickerOpen(false)
  }, [])

  const closeShadingPicker = useCallback(() => {
    setShadingPickerOpen(false)
  }, [])

  const getCellFromEvent = (event) => {
    const target = event.target
    if (!target?.closest) return null
    return target.closest('td, th')
  }

  const focusCellFromEvent = (event) => {
    if (!editor) return
    const cell = getCellFromEvent(event)
    if (!cell) return
    const pos = editor.view?.posAtDOM(cell, 0)
    if (pos !== null && pos !== undefined) {
      try {
        editor.chain().focus().setTextSelection(pos + 2).run()
      } catch {
        editor.chain().focus().setTextSelection(pos).run()
      }
    }
  }

  const focusFromCoords = (coords) => {
    if (!editor) return
    const pos = editor.view?.posAtCoords(coords)
    if (pos?.pos !== undefined) {
      editor.chain().focus().setTextSelection(pos.pos).run()
    }
  }

  const getActiveBlockId = () => {
    if (!editor) return null
    const { $from } = editor.state.selection
    let fallbackId = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      const id = node?.attrs?.id
      if (!id) continue
      const type = node.type?.name
      if (type === 'paragraph' || type === 'heading') {
        return id
      }
      if (!fallbackId) fallbackId = id
    }
    return fallbackId
  }

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const handleContextMenu = (event) => {
      if (event.shiftKey) return
      event.preventDefault()
      focusFromCoords({ left: event.clientX, top: event.clientY })
      const inTable = Boolean(getCellFromEvent(event))
      const blockId = getActiveBlockId()
      openContextMenu({ x: event.clientX, y: event.clientY, blockId, inTable })
    }

    const handleTouchStart = (event) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
      const touch = event.touches?.[0]
      if (!touch) return
      const inTable = Boolean(getCellFromEvent(event))
      longPressTimerRef.current = setTimeout(() => {
        if (inTable) {
          focusCellFromEvent(event)
        } else {
          focusFromCoords({ left: touch.clientX, top: touch.clientY })
        }
        const blockId = getActiveBlockId()
        openContextMenu({ x: touch.clientX, y: touch.clientY, blockId, inTable })
      }, 550)
    }

    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    dom.addEventListener('contextmenu', handleContextMenu)
    dom.addEventListener('touchstart', handleTouchStart, { passive: true })
    dom.addEventListener('touchmove', cancelLongPress, { passive: true })
    dom.addEventListener('touchend', cancelLongPress)
    dom.addEventListener('touchcancel', cancelLongPress)

    return () => {
      dom.removeEventListener('contextmenu', handleContextMenu)
      dom.removeEventListener('touchstart', handleTouchStart)
      dom.removeEventListener('touchmove', cancelLongPress)
      dom.removeEventListener('touchend', cancelLongPress)
      dom.removeEventListener('touchcancel', cancelLongPress)
    }
  }, [editor, openContextMenu])

  useEffect(() => {
    if (!contextMenu.open) return
    const menu = contextMenuRef.current
    if (!menu) return
    const padding = 8
    const rect = menu.getBoundingClientRect()
    let nextX = Math.min(contextMenu.x, window.innerWidth - rect.width - padding)
    let nextY = Math.min(contextMenu.y, window.innerHeight - rect.height - padding)
    nextX = Math.max(padding, nextX)
    nextY = Math.max(padding, nextY)
    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => ({ ...prev, x: nextX, y: nextY }))
    }
  }, [contextMenu.open, contextMenu.x, contextMenu.y])

  useEffect(() => {
    if (!submenuOpen) return
    const menu = contextMenuRef.current
    const submenu = submenuRef.current
    if (!menu || !submenu) return
    const padding = 12
    const menuRect = menu.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const openRight = menuRect.right + submenuRect.width + padding < window.innerWidth
    setSubmenuDirection(openRight ? 'right' : 'left')
  }, [submenuOpen])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (tablePickerOpen) {
        const picker = tablePickerRef.current
        const button = tableButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setTablePickerOpen(false)
      }
      if (highlightPickerOpen) {
        const picker = highlightPickerRef.current
        const button = highlightButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setHighlightPickerOpen(false)
      }
      if (shadingPickerOpen) {
        const picker = shadingPickerRef.current
        const button = shadingButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setShadingPickerOpen(false)
      }
      if (aiDailyPickerOpen) {
        const picker = aiDailyPickerRef.current
        const button = aiDailyButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setAiDailyPickerOpen(false)
      }
      if (contextMenu.open) {
        const menu = contextMenuRef.current
        if (menu?.contains(event.target)) return
        closeContextMenu()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTablePickerOpen(false)
        setHighlightPickerOpen(false)
        setShadingPickerOpen(false)
        setAiDailyPickerOpen(false)
        if (!aiInsertLoading) {
          setAiInsertOpen(false)
        }
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    tablePickerOpen,
    highlightPickerOpen,
    shadingPickerOpen,
    aiDailyPickerOpen,
    contextMenu.open,
    aiInsertLoading,
    closeContextMenu,
  ])

  const tableGrid = useMemo(() => {
    return Array.from({ length: gridSize }, (_, rowIndex) =>
      Array.from({ length: gridSize }, (_, colIndex) => ({
        row: rowIndex + 1,
        col: colIndex + 1,
      })),
    )
  }, [gridSize])

  const handleInsertTable = (rows, cols) => {
    if (!editor) return
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()
    closeTablePicker()
  }

  const handleApplyShading = () => {
    if (!editor) return
    if (!shadingColor) {
      editor.chain().focus().setCellAttribute('backgroundColor', null).run()
      return
    }
    editor.chain().focus().setCellAttribute('backgroundColor', shadingColor).run()
  }

  const handlePickShading = (color) => {
    if (!editor) return
    if (!color) {
      setShadingColor(null)
      editor.chain().focus().setCellAttribute('backgroundColor', null).run()
    } else {
      setShadingColor(color)
      editor.chain().focus().setCellAttribute('backgroundColor', color).run()
    }
    closeShadingPicker()
  }

  const handleCustomShading = (event) => {
    const color = event.target.value
    if (!color) return
    handlePickShading(color)
  }

  const openCustomShading = () => {
    shadingInputRef.current?.click()
  }

  const hexToRgb = (hex) => {
    const normalized = hex.replace('#', '')
    const value =
      normalized.length === 3
        ? normalized
            .split('')
            .map((char) => char + char)
            .join('')
        : normalized
    const intValue = parseInt(value, 16)
    return {
      r: (intValue >> 16) & 255,
      g: (intValue >> 8) & 255,
      b: intValue & 255,
    }
  }

  const toHex = (value) => value.toString(16).padStart(2, '0')

  const mixColors = (base, mixWith, amount) => {
    const a = hexToRgb(base)
    const b = hexToRgb(mixWith)
    const mix = (start, end) => Math.round(start * (1 - amount) + end * amount)
    return `#${toHex(mix(a.r, b.r))}${toHex(mix(a.g, b.g))}${toHex(mix(a.b, b.b))}`
  }

  const themeBaseColors = useMemo(
    () => [
      { label: 'White', value: '#ffffff' },
      { label: 'Black', value: '#000000' },
      { label: 'Dark Blue-Gray', value: '#1f2937' },
      { label: 'Dark Blue', value: '#1e3a8a' },
      { label: 'Medium Blue', value: '#2563eb' },
      { label: 'Red', value: '#ef4444' },
      { label: 'Dark Red', value: '#7f1d1d' },
      { label: 'Orange', value: '#f97316' },
      { label: 'Gold/Yellow', value: '#f59e0b' },
      { label: 'Green', value: '#16a34a' },
    ],
    [],
  )

  const themeRows = useMemo(() => {
    const lightSteps = [0.2, 0.4, 0.6, 0.8]
    return [
      themeBaseColors.map((color) => color.value),
      ...lightSteps.map((amount) =>
        themeBaseColors.map((color) => {
          const base = color.value.toLowerCase()
          if (base === '#ffffff') {
            return mixColors(base, '#000000', amount)
          }
          if (base === '#000000') {
            return mixColors(base, '#ffffff', amount)
          }
          return mixColors(base, '#ffffff', amount)
        }),
      ),
    ]
  }, [themeBaseColors])

  const standardColors = useMemo(
    () => [
      '#7f1d1d',
      '#ef4444',
      '#f97316',
      '#f59e0b',
      '#22c55e',
      '#0f766e',
      '#3b82f6',
      '#1e3a8a',
      '#0f172a',
      '#7c3aed',
    ],
    [],
  )

  useEffect(() => {
    if (!editor) return
    const syncTableState = () => {
      const nextInTable =
        editor.isActive('table') || editor.isActive('tableCell') || editor.isActive('tableHeader')
      setInTable(nextInTable)
      if (!nextInTable) return
      const headerColor = editor.getAttributes('tableHeader')?.backgroundColor
      const cellColor = editor.getAttributes('tableCell')?.backgroundColor
      setShadingColor(headerColor || cellColor || null)
    }
    syncTableState()
    editor.on('selectionUpdate', syncTableState)
    editor.on('transaction', syncTableState)
    return () => {
      editor.off('selectionUpdate', syncTableState)
      editor.off('transaction', syncTableState)
    }
  }, [editor])

  const handleApplyHighlight = () => {
    if (!editor) return
    if (!highlightColor) {
      editor.chain().focus().unsetHighlight().run()
      return
    }
    editor.chain().focus().setHighlight({ color: highlightColor }).run()
  }

  const handlePickHighlight = (color) => {
    if (!editor) return
    if (!color) {
      setHighlightColor(null)
      editor.chain().focus().unsetHighlight().run()
    } else {
      setHighlightColor(color)
      editor.chain().focus().setHighlight({ color }).run()
    }
    closeHighlightPicker()
  }

  const highlightColors = useMemo(
    () => [
      [
        { label: 'Yellow', value: '#fef08a' },
        { label: 'Green', value: '#86efac' },
        { label: 'Cyan', value: '#67e8f9' },
        { label: 'Magenta', value: '#f0abfc' },
        { label: 'Blue', value: '#93c5fd' },
      ],
      [
        { label: 'Red', value: '#fca5a5' },
        { label: 'Dark Navy', value: '#0f172a' },
        { label: 'Teal', value: '#0d9488' },
        { label: 'Dark Green', value: '#166534' },
        { label: 'Purple', value: '#7c3aed' },
      ],
      [
        { label: 'Dark Maroon', value: '#7f1d1d' },
        { label: 'Olive', value: '#a16207' },
        { label: 'Gray', value: '#6b7280' },
        { label: 'Light Gray', value: '#d1d5db' },
        { label: 'Black', value: '#000000' },
      ],
      [
        { label: 'Light Yellow', value: '#fef9c3' },
        { label: 'Light Green', value: '#dcfce7' },
        { label: 'Light Cyan', value: '#cffafe' },
        { label: 'Pink', value: '#fbcfe8' },
        { label: 'Light Blue', value: '#dbeafe' },
      ],
      [
        { label: 'Orange', value: '#fdba74' },
        { label: 'Medium Light Green', value: '#bbf7d0' },
        { label: 'Medium Cyan', value: '#99f6e4' },
        { label: 'Lavender', value: '#e9d5ff' },
        { label: 'Bright Cyan', value: '#22d3ee' },
      ],
      [
        { label: 'Light Orange', value: '#fed7aa' },
        { label: 'Pale Green', value: '#ecfccb' },
        { label: 'Pale Teal', value: '#ccfbf1' },
        { label: 'Pale Lavender', value: '#f3e8ff' },
        { label: 'Pale Blue', value: '#e0f2fe' },
      ],
    ],
    [],
  )

  useEffect(() => {
    if (!editor) return
    const syncHighlight = () => {
      const color = editor.getAttributes('highlight')?.color
      if (color) setHighlightColor(color)
    }
    editor.on('selectionUpdate', syncHighlight)
    editor.on('transaction', syncHighlight)
    return () => {
      editor.off('selectionUpdate', syncHighlight)
      editor.off('transaction', syncHighlight)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.storage.highlightColor = highlightColor ?? null
  }, [editor, highlightColor])

  const getActiveCellColor = useCallback(() => {
    if (!editor) return null
    return editor.getAttributes('tableCell')?.backgroundColor ?? editor.getAttributes('tableHeader')?.backgroundColor ?? null
  }, [editor])

  const getTableContext = useCallback(() => {
    if (!editor) return null
    const { state } = editor
    const { $from } = state.selection
    let tableDepth = null
    let cellDepth = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const nodeName = $from.node(depth).type.name
      if (cellDepth === null && (nodeName === 'tableCell' || nodeName === 'tableHeader')) {
        cellDepth = depth
      }
      if (nodeName === 'table') {
        tableDepth = depth
        break
      }
    }
    if (tableDepth === null || cellDepth === null) return null
    const tableNode = $from.node(tableDepth)
    const tablePos = $from.before(tableDepth)
    const tableStart = $from.start(tableDepth)
    const cellPos = $from.before(cellDepth)
    const map = TableMap.get(tableNode)
    const cellPosRel = cellPos - tableStart
    const cellRect = map.findCell(cellPosRel)
    return { tablePos, cellRect }
  }, [editor])

  const applyColorToRow = useCallback(
    (tablePos, rowIndex, color) => {
      if (!editor) return
      const { state, view } = editor
      const tableNode = state.doc.nodeAt(tablePos)
      if (!tableNode) return
      const map = TableMap.get(tableNode)
      if (rowIndex < 0 || rowIndex >= map.height) return
      const tableStart = tablePos + 1
      const tr = state.tr
      const seen = new Set()
      for (let col = 0; col < map.width; col += 1) {
        const cellPos = map.map[rowIndex * map.width + col]
        if (cellPos == null || seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = tableNode.nodeAt(cellPos)
        if (!cell) continue
        tr.setNodeMarkup(tableStart + cellPos, undefined, { ...cell.attrs, backgroundColor: color })
      }
      if (tr.docChanged) view.dispatch(tr)
    },
    [editor],
  )

  const applyColorToColumn = useCallback(
    (tablePos, colIndex, color) => {
      if (!editor) return
      const { state, view } = editor
      const tableNode = state.doc.nodeAt(tablePos)
      if (!tableNode) return
      const map = TableMap.get(tableNode)
      if (colIndex < 0 || colIndex >= map.width) return
      const tableStart = tablePos + 1
      const tr = state.tr
      const seen = new Set()
      for (let row = 0; row < map.height; row += 1) {
        const cellPos = map.map[row * map.width + colIndex]
        if (cellPos == null || seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = tableNode.nodeAt(cellPos)
        if (!cell) continue
        tr.setNodeMarkup(tableStart + cellPos, undefined, { ...cell.attrs, backgroundColor: color })
      }
      if (tr.docChanged) view.dispatch(tr)
    },
    [editor],
  )

  const handleInsertRow = useCallback(
    (after) => {
      if (!editor) return
      const color = getActiveCellColor()
      const tableContext = getTableContext()
      const rowIndex = tableContext ? (after ? tableContext.cellRect.bottom : tableContext.cellRect.top) : null
      if (after) {
        editor.chain().focus().addRowAfter().run()
      } else {
        editor.chain().focus().addRowBefore().run()
      }
      if (color && tableContext && rowIndex !== null) {
        applyColorToRow(tableContext.tablePos, rowIndex, color)
      }
    },
    [editor, getActiveCellColor, getTableContext, applyColorToRow],
  )

  const handleInsertColumn = useCallback(
    (after) => {
      if (!editor) return
      const color = getActiveCellColor()
      const tableContext = getTableContext()
      const colIndex = tableContext ? (after ? tableContext.cellRect.right : tableContext.cellRect.left) : null
      if (after) {
        editor.chain().focus().addColumnAfter().run()
      } else {
        editor.chain().focus().addColumnBefore().run()
      }
      if (color && tableContext && colIndex !== null) {
        applyColorToColumn(tableContext.tablePos, colIndex, color)
      }
    },
    [editor, getActiveCellColor, getTableContext, applyColorToColumn],
  )

  const contextMenuItems = useMemo(
    () => [
      { label: 'Insert row above', action: () => handleInsertRow(false) },
      { label: 'Insert row below', action: () => handleInsertRow(true) },
      { label: 'Insert column left', action: () => handleInsertColumn(false) },
      { label: 'Insert column right', action: () => handleInsertColumn(true) },
      { label: 'Delete row', action: () => editor?.chain().focus().deleteRow().run() },
      { label: 'Delete column', action: () => editor?.chain().focus().deleteColumn().run() },
      { label: 'Delete table', action: () => editor?.chain().focus().deleteTable().run() },
    ],
    [editor, handleInsertRow, handleInsertColumn],
  )

  const deepLinkHash = useMemo(() => {
    if (!contextMenu.blockId || !notebookId || !sectionId || !trackerId) return null
    return `#nb=${notebookId}&sec=${sectionId}&pg=${trackerId}&block=${contextMenu.blockId}`
  }, [contextMenu.blockId, notebookId, sectionId, trackerId])

  const isCurrentPageTracker = Boolean(trackerId && trackerSourcePage?.id === trackerId)

  const handleCopyLink = async () => {
    if (!deepLinkHash) return
    await navigator.clipboard.writeText(deepLinkHash)
    closeContextMenu()
  }

  const handleSetTrackerPageFromMenu = async () => {
    if (!trackerId || !onSetTrackerPage || isCurrentPageTracker || trackerPageSaving) return
    await onSetTrackerPage(trackerId)
    closeContextMenu()
  }

  useEffect(() => {
    if (!editor) return
    if (typeof onNavigateHash === 'function') {
      // no-op: handled by Link extension plugin
    }
  }, [editor, onNavigateHash])

  useEffect(() => {
    if (!editor) return undefined
    const findStorage = editor.storage.findInDoc
    if (!findStorage) return undefined
    findStorage.open = openFind
    findStorage.close = closeFind
    return () => {
      if (editor.storage?.findInDoc) {
        editor.storage.findInDoc.open = null
        editor.storage.findInDoc.close = null
      }
    }
  }, [editor, openFind, closeFind])

  useEffect(() => {
    if (!editor) return undefined
    const syncFindState = () => {
      const pluginState = findInDocPluginKey.getState(editor.state)
      if (!pluginState) return
      setFindStatus(pluginState)
      setFindQuery((prev) => (prev === pluginState.query ? prev : pluginState.query || ''))
    }
    syncFindState()
    editor.on('transaction', syncFindState)
    return () => editor.off('transaction', syncFindState)
  }, [editor])

  useEffect(() => {
    if (!hasTracker) {
      closeFind()
      setAiInsertOpen(false)
      setAiInsertText('')
      return
    }
    closeFind()
    setAiInsertOpen(false)
    setAiInsertText('')
  }, [hasTracker, trackerId, closeFind])

  const hasHeaderActions = Boolean(headerActions) || showDelete

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div className="title-row">
          <input
            className="title-input"
            value={title}
            onChange={(event) => {
              if (titleReadOnly) return
              onTitleChange(event.target.value)
            }}
            placeholder="Tracker title"
            disabled={!hasTracker}
            readOnly={titleReadOnly}
          />
          {hasHeaderActions && (
            <div className="title-actions">
              {headerActions}
              {showDelete && (
                <button className="ghost" onClick={onDelete} disabled={!hasTracker}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        <div className="status-row">
          <span className="subtle">{hasTracker ? saveStatus : 'No tracker selected'}</span>
          {message && <span className="message-inline">{message}</span>}
        </div>
      </div>

      <div className={`toolbar ${!hasTracker ? 'disabled' : ''}`}>
        <button
          type="button"
          className={editor?.isActive('bold') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!hasTracker}
        >
          B
        </button>
        <button
          type="button"
          className={editor?.isActive('italic') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!hasTracker}
        >
          I
        </button>
        <button
          type="button"
          className={editor?.isActive('underline') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={!hasTracker}
        >
          U
        </button>
        <button
          type="button"
          className={editor?.isActive('strike') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          disabled={!hasTracker}
        >
          S
        </button>
        <div className="highlight-control" ref={highlightButtonRef}>
          <button
            type="button"
            className={editor?.isActive('highlight') ? 'active' : ''}
            onClick={handleApplyHighlight}
            disabled={!hasTracker}
          >
            <span className="highlight-icon">
              HL
              <span
                className="highlight-indicator"
                style={{ backgroundColor: highlightColor ?? 'transparent' }}
              />
            </span>
          </button>
          <button
            type="button"
            className="highlight-dropdown"
            onClick={() => setHighlightPickerOpen((prev) => !prev)}
            disabled={!hasTracker}
            aria-label="Highlight colors"
          >
            ▾
          </button>
          {highlightPickerOpen && (
            <div className="highlight-picker" ref={highlightPickerRef}>
              <div className="highlight-grid">
                {highlightColors.flatMap((row) =>
                  row.map((swatch) => (
                    <button
                      key={swatch.label}
                      type="button"
                      className="highlight-swatch"
                      style={{ backgroundColor: swatch.value }}
                      onClick={() => handlePickHighlight(swatch.value)}
                      aria-label={swatch.label}
                    />
                  )),
                )}
              </div>
              <button type="button" className="highlight-none" onClick={() => handlePickHighlight(null)}>
                No Color
              </button>
            </div>
          )}
        </div>
        <input
          type="color"
          aria-label="Text color"
          onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
          disabled={!hasTracker}
        />

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          disabled={!hasTracker}
        >
          H1
        </button>
        <button
          type="button"
          className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!hasTracker}
        >
          H2
        </button>
        <button
          type="button"
          className={editor?.isActive('bulletList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!hasTracker}
        >
          • List
        </button>
        <button
          type="button"
          className={editor?.isActive('orderedList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!hasTracker}
        >
          1. List
        </button>
        <button
          type="button"
          className={editor?.isActive('taskList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          disabled={!hasTracker}
        >
          ☑ List
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive({ textAlign: 'left' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('left')}
          disabled={!hasTracker}
        >
          Left
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('center')}
          disabled={!hasTracker}
        >
          Center
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('right')}
          disabled={!hasTracker}
        >
          Right
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handleSetLink} disabled={!hasTracker}>
          Link
        </button>
        <button type="button" onClick={() => editor?.chain().focus().unsetLink().run()} disabled={!hasTracker}>
          Unlink
        </button>
        <button type="button" onClick={openFind} disabled={!hasTracker}>
          Find
        </button>
        <button type="button" onClick={() => editor?.chain().focus().undo().run()} disabled={!hasTracker}>
          Undo
        </button>
        <button type="button" onClick={() => editor?.chain().focus().redo().run()} disabled={!hasTracker}>
          Redo
        </button>
        <button type="button" onClick={handleExportText} disabled={!hasTracker}>
          Export
        </button>
        {showAiDaily && (
          <div className="ai-daily-control" ref={aiDailyButtonRef}>
            <button type="button" onClick={handleGenerateToday} disabled={!hasTracker || aiLoading || aiInsertLoading}>
              {aiLoading ? 'Generating...' : 'AI Daily'}
            </button>
            <button
              type="button"
              className="ai-daily-dropdown"
              onClick={() => setAiDailyPickerOpen((prev) => !prev)}
              disabled={!hasTracker || aiLoading || aiInsertLoading}
              aria-label="Pick date for AI Daily"
            >
              ▾
            </button>
            {aiDailyPickerOpen && (
              <div className="ai-daily-picker" ref={aiDailyPickerRef}>
                <div className="ai-daily-date-nav">
                  <button type="button" onClick={handleAiDailyPrevDay}>&#8249;</button>
                  <span className="ai-daily-date-label">
                    {aiDailyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button type="button" onClick={handleAiDailyNextDay}>&#8250;</button>
                </div>
                <input
                  type="date"
                  value={aiDailyDate.toLocaleDateString('en-CA')}
                  onChange={(e) => handleAiDailyDateChange(e.target.value)}
                  className="ai-daily-date-input"
                />
              </div>
            )}
          </div>
        )}
        {showAiInsert && (
          <button
            type="button"
            onClick={() => {
              setAiDailyPickerOpen(false)
              setAiInsertOpen(true)
            }}
            disabled={!hasTracker || aiLoading || aiInsertLoading}
          >
            {aiInsertLoading ? 'Inserting...' : 'AI Insert'}
          </button>
        )}

        <div className="toolbar-divider" />

        <div className="table-picker-wrap">
          <button
            type="button"
            ref={tableButtonRef}
            onClick={() => setTablePickerOpen((prev) => !prev)}
            disabled={!hasTracker}
          >
            Table
          </button>
          {tablePickerOpen && (
            <div
              className="table-picker-backdrop"
              onClick={closeTablePicker}
              aria-hidden="true"
            />
          )}
          {tablePickerOpen && (
            <div className="table-picker" ref={tablePickerRef}>
              <div className="table-picker-grid">
                {tableGrid.map((row) =>
                  row.map((cell) => {
                    const isActive =
                      cell.row <= tableSize.rows && cell.col <= tableSize.cols
                    return (
                      <div
                        key={`${cell.row}-${cell.col}`}
                        className={`table-picker-cell ${isActive ? 'active' : ''}`}
                        onMouseEnter={() => setTableSize({ rows: cell.row, cols: cell.col })}
                        onClick={() => handleInsertTable(cell.row, cell.col)}
                      />
                    )
                  }),
                )}
              </div>
              <div className="table-picker-label">
                {tableSize.rows} × {tableSize.cols}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addRowAfter().run()}
          disabled={!hasTracker}
        >
          + Row
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addColumnAfter().run()}
          disabled={!hasTracker}
        >
          + Col
        </button>
        {inTable && (
          <div className="shading-control" ref={shadingButtonRef}>
            <button
              type="button"
              className={shadingColor ? 'active' : ''}
              onClick={handleApplyShading}
              disabled={!hasTracker}
            >
              Shading
            </button>
            <button
              type="button"
              className="shading-dropdown"
              onClick={() => setShadingPickerOpen((prev) => !prev)}
              disabled={!hasTracker}
              aria-label="Shading colors"
            >
              ▾
            </button>
            {shadingPickerOpen && (
              <div className="shading-picker" ref={shadingPickerRef}>
                <div className="shading-section">
                  <p className="shading-header">Theme Colors</p>
                  <div className="shading-grid">
                    {themeRows.map((row, rowIndex) =>
                      row.map((color, colIndex) => (
                        <button
                          key={`theme-${rowIndex}-${colIndex}`}
                          type="button"
                          className={`shading-swatch ${
                            shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => handlePickShading(color)}
                          aria-label={`Theme color ${rowIndex + 1}-${colIndex + 1}`}
                        />
                      )),
                    )}
                  </div>
                </div>
                <div className="shading-section">
                  <p className="shading-header">Standard Colors</p>
                  <div className="shading-grid shading-grid-standard">
                    {standardColors.map((color, index) => (
                      <button
                        key={`standard-${color}`}
                        type="button"
                        className={`shading-swatch ${
                          shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => handlePickShading(color)}
                        aria-label={`Standard color ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="shading-actions">
                  <button type="button" className="shading-action" onClick={() => handlePickShading(null)}>
                    <span className="shading-icon" aria-hidden="true" />
                    No Color
                  </button>
                  <button type="button" className="shading-action" onClick={openCustomShading}>
                    <span className="shading-icon palette" aria-hidden="true" />
                    More Colors...
                  </button>
                  <input
                    ref={shadingInputRef}
                    type="color"
                    className="shading-input"
                    onChange={handleCustomShading}
                    aria-label="Custom shading color"
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => editor?.chain().focus().deleteTable().run()}
          disabled={!hasTracker}
        >
          Delete table
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handlePickImage} disabled={!hasTracker}>
          Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="file-input"
        />

        {findOpen && hasTracker && (
          <div className="find-bar">
            <input
              ref={findInputRef}
              type="text"
              className="find-input"
              placeholder="Find in tracker"
              value={findQuery}
              onChange={(event) => handleFindQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'F3') {
                  event.preventDefault()
                  if (event.shiftKey) {
                    handleFindPrev()
                  } else {
                    handleFindNext()
                  }
                } else if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  handleFindPrev()
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  handleFindNext()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  closeFind()
                }
              }}
            />
            <span className="find-count">
              {findStatus.matches.length > 0 ? findStatus.index + 1 : 0} of {findStatus.matches.length}
            </span>
            <button type="button" onClick={handleFindPrev} disabled={findStatus.matches.length === 0}>
              Prev
            </button>
            <button type="button" onClick={handleFindNext} disabled={findStatus.matches.length === 0}>
              Next
            </button>
            <button type="button" className="ghost" onClick={closeFind}>
              Close
            </button>
          </div>
        )}
      </div>

      {aiInsertOpen && (
        <div
          className="ai-insert-modal-backdrop"
          onMouseDown={() => {
            if (aiInsertLoading) return
            setAiInsertOpen(false)
          }}
        >
          <div className="ai-insert-modal" onMouseDown={(event) => event.stopPropagation()}>
            <h3>AI Insert</h3>
            <p className="subtle">
              Paste content and AI will place it into the current page.
            </p>
            <textarea
              ref={aiInsertInputRef}
              className="ai-insert-textarea"
              value={aiInsertText}
              onChange={(event) => setAiInsertText(event.target.value)}
              placeholder="Paste your content here..."
              rows={8}
              disabled={aiInsertLoading}
            />
            <div className="ai-insert-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setAiInsertOpen(false)}
                disabled={aiInsertLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAiInsertSubmit}
                disabled={aiInsertLoading || !aiInsertText.trim() || !hasTracker}
              >
                {aiInsertLoading ? 'Inserting...' : 'Insert into page'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-shell">
        {hasTracker ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="editor-empty">
            <p>Select a tracker or create a new one to start writing.</p>
          </div>
        )}
      </div>

      {contextMenu.open && (
        <div
          ref={contextMenuRef}
          className="table-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className={`table-context-item ${!deepLinkHash ? 'disabled' : ''}`}
            onClick={handleCopyLink}
            disabled={!deepLinkHash}
          >
            Copy link to paragraph
          </button>
          <button
            type="button"
            className={`table-context-item ${isCurrentPageTracker || trackerPageSaving ? 'disabled' : ''}`}
            onClick={handleSetTrackerPageFromMenu}
            disabled={!hasTracker || isCurrentPageTracker || trackerPageSaving || !onSetTrackerPage}
          >
            {isCurrentPageTracker ? 'This page is the tracker page' : trackerPageSaving ? 'Setting tracker page...' : 'Set this page as tracker'}
          </button>
          {contextMenu.inTable && (
            <div
              className="table-context-parent"
              onMouseEnter={() => setSubmenuOpen(true)}
              onMouseLeave={() => setSubmenuOpen(false)}
            >
              <button
                type="button"
                className="table-context-item"
                onClick={() => setSubmenuOpen((prev) => !prev)}
              >
                Table
              </button>
              {submenuOpen && (
                <div
                  ref={submenuRef}
                  className={`table-submenu ${submenuDirection === 'left' ? 'left' : 'right'}`}
                >
                  {contextMenuItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="table-context-item"
                      onClick={() => {
                        item.action()
                        closeContextMenu()
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default EditorPanel
