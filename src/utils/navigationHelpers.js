export const buildHash = ({ notebookId, sectionId, pageId, blockId }) => {
  if (!notebookId) return ''
  const params = new URLSearchParams()
  params.set('nb', notebookId)
  if (sectionId) params.set('sec', sectionId)
  if (pageId) params.set('pg', pageId)
  if (blockId) params.set('block', blockId)
  return `#${params.toString()}`
}

export const parseDeepLink = (hash) => {
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
}

export const updateHash = (hash, mode = 'replace') => {
  if (!hash || !hash.startsWith('#')) return
  if (window.location.hash === hash) return
  if (mode === 'push') {
    window.location.hash = hash
    return
  }
  window.history.replaceState(null, '', hash)
}

export const scrollToBlock = (blockId, attempts = 0) => {
  const target = document.getElementById(blockId)
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const range = document.createRange()
    range.selectNodeContents(target)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  } else if (attempts < 10) {
    setTimeout(() => scrollToBlock(blockId, attempts + 1), 50)
    return false
  }
  return false
}
