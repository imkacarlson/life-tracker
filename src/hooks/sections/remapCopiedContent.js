const NODE_TYPES_WITH_IDS = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
])

const defaultCreateId = () => crypto.randomUUID()
const defaultCreateTimestamp = () => new Date().toISOString()

const remapPageContent = (content, idMaps, createId, createTimestamp) => {
  const blockIdMap = {}
  const { pageIdMap, sectionId, notebookId } = idMaps

  const walkNodes = (node) => {
    if (!node) return node
    const output = { ...node }

    if (NODE_TYPES_WITH_IDS.has(node.type) && node.attrs?.id) {
      const newId = createId()
      blockIdMap[node.attrs.id] = newId
      output.attrs = {
        ...node.attrs,
        id: newId,
        created_at: createTimestamp(),
      }
    }

    if (node.marks) {
      output.marks = node.marks.map((mark) => {
        if (mark.type !== 'link' || !mark.attrs?.href) return mark
        const href = mark.attrs.href
        if (!href.startsWith('#pg=') && !href.startsWith('#sec=') && !href.startsWith('#nb=')) {
          return mark
        }

        const params = new URLSearchParams(href.slice(1))
        let changed = false
        const oldNotebookId = params.get('nb')
        if (oldNotebookId && notebookId && oldNotebookId === notebookId.old) {
          params.set('nb', notebookId.new)
          changed = true
        }
        const oldSectionId = params.get('sec')
        if (oldSectionId && sectionId && oldSectionId === sectionId.old) {
          params.set('sec', sectionId.new)
          changed = true
        }
        const oldPageId = params.get('pg')
        if (oldPageId && pageIdMap[oldPageId]) {
          params.set('pg', pageIdMap[oldPageId])
          changed = true
        }
        const oldBlockId = params.get('block')
        if (oldBlockId && blockIdMap[oldBlockId]) {
          params.set('block', blockIdMap[oldBlockId])
          changed = true
        }

        if (!changed) return mark
        return { ...mark, attrs: { ...mark.attrs, href: `#${params.toString()}` } }
      })
    }

    if (node.content) {
      output.content = node.content.map(walkNodes)
    }
    return output
  }

  return { content: walkNodes(content), blockIdMap }
}

const fixForwardBlockRefs = (content, blockIdMap) => {
  const walk = (node) => {
    if (!node) return node
    const output = { ...node }

    if (node.marks) {
      output.marks = node.marks.map((mark) => {
        if (mark.type !== 'link' || !mark.attrs?.href) return mark
        const href = mark.attrs.href
        if (!href.startsWith('#')) return mark

        const params = new URLSearchParams(href.slice(1))
        const blockId = params.get('block')
        if (blockId && blockIdMap[blockId]) {
          params.set('block', blockIdMap[blockId])
          return { ...mark, attrs: { ...mark.attrs, href: `#${params.toString()}` } }
        }
        return mark
      })
    }

    if (node.content) {
      output.content = node.content.map(walk)
    }
    return output
  }

  return walk(content)
}

/**
 * Regenerate navigable block ids and rewrite links across every page copied
 * with a section. The second pass resolves links whose target appeared later
 * in the same page or in a later page.
 */
export const remapCopiedContents = (
  contents,
  idMaps,
  { createId = defaultCreateId, createTimestamp = defaultCreateTimestamp } = {},
) => {
  const allBlockIds = {}
  const remappedContents = contents.map((content) => {
    if (!content) return null
    const remapped = remapPageContent(content, idMaps, createId, createTimestamp)
    Object.assign(allBlockIds, remapped.blockIdMap)
    return remapped.content
  })

  return remappedContents.map((content) =>
    content ? fixForwardBlockRefs(content, allBlockIds) : null,
  )
}
