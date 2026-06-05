// Image hydration for server-side rendering. Mirrors the logic in
// src/utils/contentHelpers.js, inlined here so the serverless function stays
// self-contained (the app util imports a sibling without a file extension,
// which raw Node ESM won't resolve outside a bundler).

export function collectStoragePaths(node, paths) {
  if (!node) return
  if (node.type === 'image' && node.attrs?.storagePath) {
    paths.add(node.attrs.storagePath)
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectStoragePaths(child, paths))
  }
}

export function applySignedUrls(node, signedMap) {
  if (!node) return node
  let updatedNode = node
  if (node.type === 'image' && node.attrs?.storagePath) {
    const nextSrc = signedMap[node.attrs.storagePath]
    if (nextSrc) {
      updatedNode = { ...node, attrs: { ...node.attrs, src: nextSrc } }
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
