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
    // Order matters for consistency:
    // 1) Apply the programmatic selection (may cause the browser to auto-scroll).
    // 2) Then perform a final centering scroll after selection-related side effects.
    const range = document.createRange()
    range.selectNodeContents(target)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)

    // Use a deterministic final scroll position. We avoid smooth scrolling here because it can be
    // interrupted/overridden by selection and focus adjustments, which is what caused "lands at bottom".
    //
    // Two rAF hops ensures we run after any rAF work triggered by selectionchange handlers.
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
