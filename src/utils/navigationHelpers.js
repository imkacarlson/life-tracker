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

const DEEP_LINK_TARGET_CLASS = 'deep-link-target'
const DEEP_LINK_TARGET_STYLE_ID = 'deep-link-target-style'
let activeDeepLinkBlockId = null

const clearDeepLinkHighlightInDocument = () => {
  document.querySelectorAll(`.${DEEP_LINK_TARGET_CLASS}`).forEach((node) => {
    node.classList.remove(DEEP_LINK_TARGET_CLASS)
  })
}

const escapeCssAttributeValue = (value) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const applyDeepLinkHighlightStyle = (blockId) => {
  if (!document?.head) return
  let styleNode = document.getElementById(DEEP_LINK_TARGET_STYLE_ID)
  if (!(styleNode instanceof HTMLStyleElement)) {
    styleNode = document.createElement('style')
    styleNode.id = DEEP_LINK_TARGET_STYLE_ID
    document.head.appendChild(styleNode)
  }
  const safeBlockId = escapeCssAttributeValue(blockId)
  styleNode.textContent = `
.editor-shell .ProseMirror [id="${safeBlockId}"] {
  background: rgba(250, 204, 21, 0.22);
  outline: 2px solid rgba(245, 158, 11, 0.85);
  outline-offset: 2px;
  border-radius: 8px;
}
`
}

const clearDeepLinkHighlightStyle = () => {
  const styleNode = document.getElementById(DEEP_LINK_TARGET_STYLE_ID)
  if (!(styleNode instanceof HTMLStyleElement)) return
  styleNode.textContent = ''
}

const applyDeepLinkHighlight = (blockId) => {
  applyDeepLinkHighlightStyle(blockId)
  const target = document.getElementById(blockId)
  if (!target) return null
  clearDeepLinkHighlightInDocument()
  target.classList.add(DEEP_LINK_TARGET_CLASS)
  return target
}

export const clearDeepLinkHighlight = () => {
  activeDeepLinkBlockId = null
  clearDeepLinkHighlightInDocument()
  clearDeepLinkHighlightStyle()
}

export const scrollToBlock = (blockId, attempts = 0) => {
  const target = applyDeepLinkHighlight(blockId)
  if (target) {
    activeDeepLinkBlockId = blockId
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'center' })
      })
    })
    ;[80, 200, 400].forEach((delay) => {
      setTimeout(() => {
        if (activeDeepLinkBlockId !== blockId) return
        const refreshed = applyDeepLinkHighlight(blockId)
        if (!refreshed) return
        if (delay <= 200) {
          refreshed.scrollIntoView({ behavior: 'auto', block: 'center' })
        }
      }, delay)
    })
    return true
  } else if (attempts < 10) {
    setTimeout(() => scrollToBlock(blockId, attempts + 1), 50)
    return false
  }
  return false
}
