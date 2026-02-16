import { useEffect, useCallback, useRef, useState } from 'react'
import { buildHash, parseDeepLink, updateHash, scrollToBlock } from '../utils/navigationHelpers'
import { resolveNavHierarchy } from '../utils/resolveNavHierarchy'

const getNavSpecificity = (value) => {
  if (!value) return 0
  if (value.pageId) return 3
  if (value.sectionId) return 2
  if (value.notebookId) return 1
  return 0
}

const isWeakerDescendantTarget = (current, next) => {
  if (!current || !next) return false
  if (getNavSpecificity(next) >= getNavSpecificity(current)) return false
  if (current.notebookId && next.notebookId && current.notebookId !== next.notebookId) return false
  if (current.sectionId && next.sectionId && current.sectionId !== next.sectionId) return false
  return true
}

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
  const navVersionRef = useRef(0)
  const initialDeepLinkRef = useRef(null)
  const initialResolvedTargetRef = useRef(undefined)
  const [initialNavReady, setInitialNavReady] = useState(false)

  const setPendingNavSafely = useCallback(
    (nextValue) => {
      if (!nextValue) {
        setPendingNav(null)
        return
      }
      const pending = getPendingNav()
      if (isWeakerDescendantTarget(pending, nextValue)) {
        return
      }
      setPendingNav(nextValue)
    },
    [getPendingNav, setPendingNav],
  )

  const navigateToHash = useCallback(
    async (hash) => {
      const parsed = typeof hash === 'string' ? parseDeepLink(hash) : hash
      if (!parsed) return

      const version = ++navVersionRef.current
      const resolved = await resolveNavHierarchy(parsed)
      if (navVersionRef.current !== version) return
      if (!resolved?.notebookId) return

      if (resolved.pageId && resolved.blockId) {
        hashBlockRef.current = { pageId: resolved.pageId, blockId: resolved.blockId }
      } else {
        hashBlockRef.current = null
      }

      setPendingNavSafely(resolved)
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
      setPendingNavSafely,
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
    if (!initialNavReady) return
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
      pageId: activeTrackerId,
      sectionId: !activeTrackerId ? activeSectionId : undefined,
      notebookId: !activeTrackerId && !activeSectionId ? activeNotebookId : undefined,
      blockId,
    })
    if (!hash) return
    const mode = navIntentRef.current === 'push' ? 'push' : 'replace'
    navIntentRef.current = null
    if (mode === 'push') {
      ignoreNextHashChangeRef.current += 1
    }
    updateHash(hash, mode)
  }, [activeNotebookId, activeSectionId, activeTrackerId, getPendingNav, initialNavReady])

  useEffect(() => {
    if (!session) {
      initialResolvedTargetRef.current = undefined
      setInitialNavReady(false)
      return
    }
    let cancelled = false

    const syncInitialHash = async () => {
      const initial = typeof window === 'undefined' ? null : parseDeepLink(window.location.hash)
      initialDeepLinkRef.current = initial
      if (!initial) {
        initialResolvedTargetRef.current = null
        setInitialNavReady(true)
        return
      }

      const resolved = await resolveNavHierarchy(initial)
      if (cancelled) return
      if (!resolved?.notebookId) {
        initialResolvedTargetRef.current = null
        setInitialNavReady(true)
        return
      }

      initialResolvedTargetRef.current = resolved
      setPendingNavSafely(resolved)
      if (resolved.pageId && resolved.blockId) {
        hashBlockRef.current = { pageId: resolved.pageId, blockId: resolved.blockId }
      } else {
        hashBlockRef.current = null
      }
    }

    syncInitialHash()

    return () => {
      cancelled = true
    }
  }, [session, setPendingNavSafely])

  useEffect(() => {
    if (!session || initialNavReady) return

    const target = initialResolvedTargetRef.current
    if (target === undefined) return
    if (!target) {
      setInitialNavReady(true)
      return
    }

    if (target.pageId && activeTrackerId === target.pageId) {
      setInitialNavReady(true)
      return
    }
    if (!target.pageId && target.sectionId && activeSectionId === target.sectionId) {
      setInitialNavReady(true)
      return
    }
    if (!target.pageId && !target.sectionId && activeNotebookId === target.notebookId) {
      setInitialNavReady(true)
      return
    }

    const hasTargetNotebook = notebooks.some((item) => item.id === target.notebookId)
    if (hasTargetNotebook) {
      if (activeNotebookId !== target.notebookId) {
        setActiveNotebookId(target.notebookId)
      }
      return
    }

    if (notebooks.length > 0) {
      setPendingNav(null)
      setInitialNavReady(true)
    }
  }, [
    session,
    notebooks,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    initialNavReady,
    setActiveNotebookId,
    setPendingNav,
  ])

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
    initialNavReady,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  }
}
