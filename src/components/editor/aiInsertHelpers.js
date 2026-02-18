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

export const buildAiInsertContent = (format, items) => {
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

export const findTargetBlockMatch = (editor, targetBlockId) => {
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

export const resolveInsertPosCandidatesFromTargetMatch = (editor, targetMatch) => {
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

  addCandidate(targetPos + targetNode.nodeSize)

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

export const resolveListInsertPlan = (editor, targetMatch, insertedContent) => {
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

  let blockDepth = null
  for (let depth = resolved.depth; depth >= 1; depth -= 1) {
    const typeName = resolved.node(depth).type?.name
    if (typeName === 'paragraph' || typeName === 'heading') {
      blockDepth = depth
      break
    }
  }
  if (blockDepth === null || blockDepth < 1) return null

  const doc = editor.state.doc
  const isBlankTextBlock = (node) => {
    const name = node?.type?.name
    if (name !== 'paragraph' && name !== 'heading') return false
    return (node.textContent || '').trim() === ''
  }

  const appendPosForListAt = (listStartPos) => {
    const inside = clampPos(listStartPos + 1)
    const listResolved = doc.resolve(inside)
    let depth = null
    for (let d = listResolved.depth; d >= 1; d -= 1) {
      if (listResolved.node(d).type?.name === listType) {
        depth = d
        break
      }
    }
    if (depth === null) return null
    return clampPos(listResolved.end(depth))
  }

  const findForwardListRun = (fromPos) => {
    let pos = clampPos(fromPos)
    let node = doc.nodeAt(pos)
    while (node && isBlankTextBlock(node)) {
      pos = clampPos(pos + node.nodeSize)
      node = doc.nodeAt(pos)
    }
    if (!node || node.type?.name !== listType) return null

    let lastPos = pos
    let scanPos = clampPos(pos + node.nodeSize)
    while (scanPos <= docSize) {
      const next = doc.nodeAt(scanPos)
      if (!next) break
      if (isBlankTextBlock(next)) {
        scanPos = clampPos(scanPos + next.nodeSize)
        continue
      }
      if (next.type?.name !== listType) break
      lastPos = scanPos
      scanPos = clampPos(scanPos + next.nodeSize)
    }

    return { pos: lastPos }
  }

  const findBackwardList = (fromPos) => {
    let pos = clampPos(fromPos)
    while (pos > 0) {
      const $pos = doc.resolve(pos)
      const prev = $pos.nodeBefore
      if (!prev) return null
      const prevStartPos = clampPos(pos - prev.nodeSize)
      if (isBlankTextBlock(prev)) {
        pos = prevStartPos
        continue
      }
      if (prev.type?.name === listType) {
        return { pos: prevStartPos }
      }
      return null
    }
    return null
  }

  const blockEndPos = resolved.after(blockDepth)
  const forward = findForwardListRun(blockEndPos)
  if (forward) {
    const pos = appendPosForListAt(forward.pos)
    if (pos !== null) return { pos, content: items }
  }

  const blockStartPos = resolved.before(blockDepth)
  const backward = findBackwardList(blockStartPos)
  if (backward) {
    const pos = appendPosForListAt(backward.pos)
    if (pos !== null) return { pos, content: items }
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

export const resolveFallbackInsertPos = (editor) => {
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

export const normalizeAiInsertResponse = (data) => {
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
