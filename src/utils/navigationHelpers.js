export const buildHash = ({ notebookId, sectionId, pageId, blockId }) => {
  const params = new URLSearchParams()
  if (notebookId) params.set('nb', notebookId)
  if (sectionId) params.set('sec', sectionId)
  if (pageId) params.set('pg', pageId)
  if (blockId) params.set('block', blockId)
  if (!params.size) return ''
  return `#${params.toString()}`
}

export const parseDeepLink = (hash) => {
  if (!hash || !hash.startsWith('#')) return null
  if (!hash.startsWith('#pg=') && !hash.startsWith('#sec=') && !hash.startsWith('#nb=')) {
    return null
  }
  const params = new URLSearchParams(hash.slice(1))
  const notebookId = params.get('nb')
  const sectionId = params.get('sec')
  const pageId = params.get('pg')
  if (!notebookId && !sectionId && !pageId) return null
  return {
    notebookId,
    sectionId,
    pageId,
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'center' })
      })
    })
    return true
  } else if (attempts < 10) {
    setTimeout(() => scrollToBlock(blockId, attempts + 1), 50)
    return false
  }
  return false
}
