import { EMPTY_DOC } from './constants'

export const normalizeContent = (content) => {
  if (content && typeof content === 'object' && content.type) return content
  return EMPTY_DOC
}

export const collectStoragePaths = (node, paths) => {
  if (!node) return
  if (node.type === 'image' && node.attrs?.storagePath) {
    paths.add(node.attrs.storagePath)
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectStoragePaths(child, paths))
  }
}

export const applySignedUrls = (node, signedMap) => {
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

export const sanitizeContentForSave = (content) => {
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
