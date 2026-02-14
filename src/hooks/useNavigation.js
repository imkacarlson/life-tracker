import { useEffect, useCallback, useRef } from 'react'
import { buildHash, parseDeepLink, updateHash, scrollToBlock } from '../utils/navigationHelpers'
import { resolveNavHierarchy } from '../utils/resolveNavHierarchy'

export const useNavigation = ({
  session,
  notebooks,
  activeNotebookId,
  activeSectionId,
  activeTrackerId,
  setActiveNotebookId,
  setActiveSectionId,
  setActiveTrackerId,
  getPendingNav,
  setPendingNav,
}) => {
  const navIntentRef = useRef(null)
  const ignoreNextHashChangeRef = useRef(0)
  const hashBlockRef = useRef(null)
  const navigateToHashRef = useRef(null)

  const navigateToHash = useCallback(
    async (hash) => {
      const parsed = typeof hash === 'string' ? parseDeepLink(hash) : hash
      if (!parsed) return

      const resolved = await resolveNavHierarchy(parsed)
      if (!resolved?.notebookId) return

      if (resolved.pageId && resolved.blockId) {
        hashBlockRef.current = { pageId: resolved.pageId, blockId: resolved.blockId }
      } else {
        hashBlockRef.current = null
      }

      setPendingNav(resolved)
      if (resolved.pageId && resolved.pageId === activeTrackerId) {
        requestAnimationFrame(() => {
          if (resolved.blockId) {
            scrollToBlock(resolved.blockId)
          }
          setPendingNav(null)
        })
        return
      }

      if (resolved.notebookId === activeNotebookId) {
        if (resolved.sectionId && resolved.sectionId !== activeSectionId) {
          setActiveSectionId(resolved.sectionId)
          return
        }
        if (resolved.pageId && resolved.pageId !== activeTrackerId) {
          setActiveTrackerId(resolved.pageId)
          return
        }
        setPendingNav(null)
        return
      }

      if (notebooks.some((item) => item.id === resolved.notebookId)) {
        setActiveNotebookId(resolved.notebookId)
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
      setPendingNav,
    ],
  )

  const handleInternalHashNavigate = useCallback((href) => {
    if (!href) return
    const isInternalHash = href.startsWith('#pg=') || href.startsWith('#sec=') || href.startsWith('#nb=')
    if (!isInternalHash) return
    if (window.location.hash === href) {
      navigateToHashRef.current?.(href)
      return
    }
    window.location.hash = href
  }, [])

  const clearBlockAnchorIfPresent = useCallback(() => {
    const parsed = parseDeepLink(window.location.hash)
    if (!parsed?.blockId) return
    const hash = buildHash({
      notebookId: parsed.notebookId,
      sectionId: parsed.sectionId,
      pageId: parsed.pageId,
      blockId: null,
    })
    if (!hash) return
    hashBlockRef.current = null
    updateHash(hash, 'replace')
  }, [])

  useEffect(() => {
    navigateToHashRef.current = navigateToHash
  }, [navigateToHash])

  useEffect(() => {
    if (!activeNotebookId) return
    const blockInfo = hashBlockRef.current
    if (blockInfo && blockInfo.pageId !== activeTrackerId) {
      const pending = getPendingNav()
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
  }, [activeNotebookId, activeSectionId, activeTrackerId, getPendingNav])

  useEffect(() => {
    if (!session) return
    let cancelled = false

    const syncInitialHash = async () => {
      const initial = parseDeepLink(window.location.hash)
      if (!initial) return

      const resolved = await resolveNavHierarchy(initial)
      if (!resolved || cancelled) return

      setPendingNav(resolved)
      if (resolved.pageId && resolved.blockId) {
        hashBlockRef.current = { pageId: resolved.pageId, blockId: resolved.blockId }
      } else {
        hashBlockRef.current = null
      }
      if (notebooks.some((item) => item.id === resolved.notebookId)) {
        setActiveNotebookId(resolved.notebookId)
      }
    }

    syncInitialHash()

    return () => {
      cancelled = true
    }
  }, [session, notebooks, setActiveNotebookId, setPendingNav])

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
    navIntentRef,
    hashBlockRef,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  }
}
