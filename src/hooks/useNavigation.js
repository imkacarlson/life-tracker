import { useEffect, useCallback, useRef, useState } from 'react'
import {
  buildHash,
  parseDeepLink,
  updateHash,
  scrollToBlock,
  clearDeepLinkHighlight,
} from '../utils/navigationHelpers'
import { resolveNavHierarchy } from '../utils/resolveNavHierarchy'
import { saveSelection } from '../utils/storage'
import {
  getNavigationApplyStep,
  isWeakerDescendantTarget,
  normalizeNavigationTarget,
} from '../utils/navigationTarget'

export const useNavigation = ({
  session,
  notebooks,
  sections,
  trackers,
  sectionsLoading,
  dataLoading,
  loadedTrackerSectionId,
  editorReady = true,
  activeNotebookId,
  activeSectionId,
  activeTrackerId,
  setActiveNotebookId,
  setActiveSectionId,
  setActiveTrackerId,
  getPendingNav,
  setPendingNav,
  savedSelectionRef,
  setDeepLinkFocusGuard,
}) => {
  const navIntentRef = useRef(null)
  const ignoreHashChangeRef = useRef(null)
  const hashBlockRef = useRef(null)
  const navigateToHashRef = useRef(null)
  const navVersionRef = useRef(0)
  const [initialNavReady, setInitialNavReady] = useState(false)
  const [pendingTarget, setPendingTarget] = useState(null)

  const clearPendingTarget = useCallback(() => {
    setPendingTarget(null)
    setPendingNav(null)
  }, [setPendingNav])

  const setPendingTargetSafely = useCallback(
    (nextValue) => {
      if (!nextValue) {
        clearPendingTarget()
        return
      }
      const normalized = normalizeNavigationTarget(nextValue)
      const pending = getPendingNav()
      if (isWeakerDescendantTarget(pending, normalized)) {
        return
      }
      setPendingTarget(normalized)
      setPendingNav(normalized)
    },
    [clearPendingTarget, getPendingNav, setPendingNav],
  )

  const queueResolvedTarget = useCallback(
    (target, { hashMode = null } = {}) => {
      if (!target?.notebookId) return
      const normalized = normalizeNavigationTarget(target)
      if (hashMode) navIntentRef.current = hashMode
      if (normalized.pageId && normalized.blockId) {
        hashBlockRef.current = { pageId: normalized.pageId, blockId: normalized.blockId }
      } else {
        hashBlockRef.current = null
        clearDeepLinkHighlight()
      }
      setPendingTargetSafely(normalized)
    },
    [setPendingTargetSafely],
  )

  const navigateToHash = useCallback(
    async (hash) => {
      const parsed = typeof hash === 'string' ? parseDeepLink(hash) : hash
      if (!parsed) return
      if (parsed.blockId) {
        setDeepLinkFocusGuard(true)
      }

      const version = ++navVersionRef.current
      const resolved = await resolveNavHierarchy(parsed)
      if (navVersionRef.current !== version) return
      if (!resolved?.notebookId) {
        console.warn('[nav] resolveNavHierarchy returned null for hash=%s — navigation dropped', hash)
        clearPendingTarget()
        setInitialNavReady(true)
        return
      }

      queueResolvedTarget(resolved)
    },
    [clearPendingTarget, queueResolvedTarget, setDeepLinkFocusGuard],
  )

  const selectNavigationTarget = useCallback(
    (target) => {
      setDeepLinkFocusGuard(false)
      queueResolvedTarget(target, { hashMode: 'push' })
    },
    [queueResolvedTarget, setDeepLinkFocusGuard],
  )

  const handleInternalHashNavigate = useCallback((href) => {
    if (!href) return
    const isInternalHash = href.startsWith('#pg=') || href.startsWith('#sec=') || href.startsWith('#nb=')
    if (!isInternalHash) return
    setDeepLinkFocusGuard(true)
    if (window.location.hash !== href) {
      window.location.hash = href
    }
    navigateToHashRef.current?.(href)
  }, [setDeepLinkFocusGuard])

  const clearBlockAnchorIfPresent = useCallback(() => {
    setDeepLinkFocusGuard(false)
    const parsed = parseDeepLink(window.location.hash)
    if (!parsed?.blockId) {
      clearDeepLinkHighlight()
      return
    }
    const hash = buildHash({
      notebookId: parsed.notebookId,
      sectionId: parsed.sectionId,
      pageId: parsed.pageId,
      blockId: null,
    })
    if (!hash) return
    hashBlockRef.current = null
    clearDeepLinkHighlight()
    updateHash(hash, 'replace')
  }, [setDeepLinkFocusGuard])

  useEffect(() => {
    navigateToHashRef.current = navigateToHash
  }, [navigateToHash])

  useEffect(() => {
    if (!session) {
      clearPendingTarget()
      setInitialNavReady(false)
      return
    }

    let cancelled = false

    const syncInitialTarget = async () => {
      const hashTarget = typeof window === 'undefined' ? null : parseDeepLink(window.location.hash)
      const savedTarget = savedSelectionRef?.current ?? null
      const initialTarget = hashTarget ?? savedTarget

      if (!initialTarget) {
        setInitialNavReady(true)
        return
      }

      const version = ++navVersionRef.current
      const resolved = await resolveNavHierarchy(initialTarget)
      if (cancelled || navVersionRef.current !== version) return
      if (!resolved?.notebookId) {
        setInitialNavReady(true)
        return
      }

      queueResolvedTarget(resolved)
    }

    syncInitialTarget()

    return () => {
      cancelled = true
    }
  }, [session, clearPendingTarget, queueResolvedTarget, savedSelectionRef])

  useEffect(() => {
    if (!session || !pendingTarget) return

    const step = getNavigationApplyStep({
      target: pendingTarget,
      notebooks,
      sections,
      trackers,
      activeNotebookId,
      activeSectionId,
      activeTrackerId,
      sectionsLoading,
      dataLoading,
      loadedTrackerSectionId,
    })

    if (step.type === 'wait') return

    if (step.type === 'missing') {
      clearPendingTarget()
      setInitialNavReady(true)
      return
    }

    if (step.type === 'notebook') {
      setActiveNotebookId(step.id)
      return
    }

    if (step.type === 'section') {
      setActiveSectionId(step.id)
      return
    }

    if (step.type === 'page') {
      setActiveTrackerId(step.id)
      return
    }

    setInitialNavReady(true)
    if (!pendingTarget.blockId) {
      clearPendingTarget()
      return
    }
    if (!editorReady) return

    requestAnimationFrame(() => {
      const found = scrollToBlock(pendingTarget.blockId)
      if (found) clearPendingTarget()
    })
  }, [
    session,
    pendingTarget,
    notebooks,
    sections,
    trackers,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    sectionsLoading,
    dataLoading,
    loadedTrackerSectionId,
    editorReady,
    setActiveNotebookId,
    setActiveSectionId,
    setActiveTrackerId,
    clearPendingTarget,
  ])

  useEffect(() => {
    if (!initialNavReady) return
    if (!activeNotebookId) return
    if (pendingTarget) return

    const blockInfo = hashBlockRef.current
    if (blockInfo && blockInfo.pageId !== activeTrackerId) {
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
    if (mode === 'push' && window.location.hash !== hash) {
      ignoreHashChangeRef.current = hash
    }
    updateHash(hash, mode)
    if (blockId && activeTrackerId) {
      requestAnimationFrame(() => {
        scrollToBlock(blockId)
      })
    }
  }, [activeNotebookId, activeSectionId, activeTrackerId, initialNavReady, pendingTarget])

  useEffect(() => {
    if (!session || !initialNavReady || pendingTarget) return
    const savedSelection = savedSelectionRef?.current
    if (savedSelection?.notebookId && !activeNotebookId) return
    if (
      activeNotebookId &&
      savedSelection?.notebookId === activeNotebookId &&
      savedSelection.sectionId &&
      !activeSectionId &&
      (sectionsLoading || sections.length > 0)
    ) {
      return
    }
    if (
      activeSectionId &&
      savedSelection?.sectionId === activeSectionId &&
      savedSelection.pageId &&
      !activeTrackerId &&
      (dataLoading || loadedTrackerSectionId !== activeSectionId || trackers.length > 0)
    ) {
      return
    }
    if (activeNotebookId && sectionsLoading) return
    if (activeSectionId && dataLoading) return
    if (activeSectionId && loadedTrackerSectionId !== activeSectionId) return
    saveSelection(activeNotebookId, activeSectionId, activeTrackerId)
    if (savedSelectionRef) {
      savedSelectionRef.current = {
        notebookId: activeNotebookId,
        sectionId: activeSectionId,
        pageId: activeTrackerId,
      }
    }
  }, [
    session,
    initialNavReady,
    pendingTarget,
    savedSelectionRef,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    sectionsLoading,
    dataLoading,
    loadedTrackerSectionId,
    sections.length,
    trackers.length,
  ])

  useEffect(() => {
    const handleHashChange = () => {
      if (ignoreHashChangeRef.current && window.location.hash === ignoreHashChangeRef.current) {
        ignoreHashChangeRef.current = null
        return
      }
      ignoreHashChangeRef.current = null
      navigateToHash(window.location.hash)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [navigateToHash])

  return {
    navIntentRef,
    hashBlockRef,
    initialNavReady,
    pendingTarget,
    isNavigating: Boolean(pendingTarget),
    selectNavigationTarget,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  }
}
