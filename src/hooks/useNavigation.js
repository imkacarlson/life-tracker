import { useEffect, useCallback, useRef } from 'react'
import { buildHash, parseDeepLink, updateHash, scrollToBlock } from '../utils/navigationHelpers'

export const useNavigation = ({
  session,
  notebooks,
  activeNotebookId,
  activeSectionId,
  activeTrackerId,
  setActiveNotebookId,
  setActiveSectionId,
  setActiveTrackerId,
  pendingNavRef: externalPendingNavRef,
}) => {
  const internalPendingNavRef = useRef(null)
  const pendingNavRef = externalPendingNavRef ?? internalPendingNavRef
  const navIntentRef = useRef(null)
  const ignoreNextHashChangeRef = useRef(0)
  const hashBlockRef = useRef(null)
  const navigateRef = useRef(null)

  const navigateToHash = useCallback(
    (hash) => {
      const parsed = typeof hash === 'string' ? parseDeepLink(hash) : hash
      if (!parsed?.notebookId) return
      if (parsed.pageId && parsed.blockId) {
        hashBlockRef.current = { pageId: parsed.pageId, blockId: parsed.blockId }
      } else {
        hashBlockRef.current = null
      }
      pendingNavRef.current = parsed
      if (parsed.pageId && parsed.pageId === activeTrackerId) {
        requestAnimationFrame(() => {
          if (parsed.blockId) {
            scrollToBlock(parsed.blockId)
          }
          pendingNavRef.current = null
        })
        return
      }
      if (parsed.notebookId === activeNotebookId) {
        if (parsed.sectionId && parsed.sectionId !== activeSectionId) {
          setActiveSectionId(parsed.sectionId)
          return
        }
        if (parsed.pageId && parsed.pageId !== activeTrackerId) {
          setActiveTrackerId(parsed.pageId)
          return
        }
        pendingNavRef.current = null
        return
      }
      if (notebooks.some((item) => item.id === parsed.notebookId)) {
        setActiveNotebookId(parsed.notebookId)
      }
    },
    [
      notebooks,
      activeTrackerId,
      activeNotebookId,
      activeSectionId,
      setActiveNotebookId,
      setActiveSectionId,
      setActiveTrackerId,
    ],
  )

  const handleInternalHashNavigate = useCallback(
    (href) => {
      if (!href || !href.startsWith('#nb=')) return
      if (window.location.hash === href) {
        navigateToHash(href)
        return
      }
      window.location.hash = href
    },
    [navigateToHash],
  )

  useEffect(() => {
    navigateRef.current = handleInternalHashNavigate
  }, [handleInternalHashNavigate])

  useEffect(() => {
    if (!activeNotebookId) return
    const blockInfo = hashBlockRef.current
    if (blockInfo && blockInfo.pageId !== activeTrackerId) {
      const pending = pendingNavRef.current
      if (pending?.pageId === blockInfo.pageId) return
      hashBlockRef.current = null
    }
    const blockId =
      blockInfo && blockInfo.pageId === activeTrackerId ? blockInfo.blockId : null
    const hash = buildHash({
      notebookId: activeNotebookId,
      sectionId: activeSectionId,
      pageId: activeTrackerId,
      blockId,
    })
    if (!hash) return
    const mode = navIntentRef.current === 'push' ? 'push' : 'replace'
    navIntentRef.current = null
    if (mode === 'push') {
      ignoreNextHashChangeRef.current += 1
    }
    updateHash(hash, mode)
  }, [activeNotebookId, activeSectionId, activeTrackerId])

  useEffect(() => {
    if (!session) return
    const initial = parseDeepLink(window.location.hash)
    if (initial) {
      pendingNavRef.current = initial
      if (initial.pageId && initial.blockId) {
        hashBlockRef.current = { pageId: initial.pageId, blockId: initial.blockId }
      } else {
        hashBlockRef.current = null
      }
      if (notebooks.some((item) => item.id === initial.notebookId)) {
        setActiveNotebookId(initial.notebookId)
      }
    }
  }, [session, notebooks, setActiveNotebookId])

  useEffect(() => {
    const handleHashChange = () => {
      if (ignoreNextHashChangeRef.current > 0) {
        ignoreNextHashChangeRef.current -= 1
        return
      }
      navigateToHash(window.location.hash)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [navigateToHash])

  return {
    pendingNavRef,
    navIntentRef,
    hashBlockRef,
    navigateRef,
    handleInternalHashNavigate,
  }
}
