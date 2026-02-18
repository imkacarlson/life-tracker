export const normalizeTemplateContent = (content) => {
  if (content && typeof content === 'object' && content.type) return content
  return { type: 'doc', content: [] }
}

export const hasMeaningfulTemplate = (doc) => {
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

export const getMergeableTemplateList = (nodes) => {
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

export const hydrateContentWithSignedUrls = async (content, supabaseClient) => {
  const doc = normalizeTemplateContent(content)
  const paths = new Set()
  collectStoragePaths(doc, paths)
  if (paths.size === 0) return doc

  const entries = await Promise.all(
    Array.from(paths).map(async (path) => {
      const { data, error } = await supabaseClient.storage
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
