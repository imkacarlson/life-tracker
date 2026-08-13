import { useEffect, useCallback, useRef, useState } from 'react'
import {
  buildHash,
  parseDeepLink,
  updateHash,
  scrollToBlock,
  clearDeepLinkHighlight,
} from '../utils/navigationHelpers'
import { resolveNavHierarchy } from '../utils/resolveNavHierarchy'
import { readStoredSelection, saveSelection } from '../utils/storage'
import {
  getNavigationTargetStatus,
  isWeakerDescendantTarget,
  normalizeNavigationTarget,
  targetMatchesSelection,
} from '../utils/navigationTarget'
import { SECTION_PAGE_STATUS, getSectionPageEntry } from '../utils/sectionPages'
import { useNavigationSelectionStore } from '../stores/navigationSelectionStore'

const sameNavigationTarget = (a, b) =>
  Boolean(a && b) &&
  a.notebookId === b.notebookId &&
  a.sectionId === b.sectionId &&
  a.pageId === b.pageId &&
  a.blockId === b.blockId

export const useNavigation = ({
  session,
  notebooks,
  notebooksLoading,
  sections,
  sectionPageCache,
  sectionsLoading,
  loadSectionPagesMeta,
  editorReady = true,
  flushSaveForTracker,
  setDeepLinkFocusGuard,
  setMessage,
}) => {
  const activeNotebookId = useNavigationSelectionStore((state) => state.activeNotebookId)
  const activeSectionId = useNavigationSelectionStore((state) => state.activeSectionId)
  const activeTrackerId = useNavigationSelectionStore((state) => state.activeTrackerId)
  const selectTarget = useNavigationSelectionStore((state) => state.selectTarget)
  const navIntentRef = useRef(null)
  const ignoreHashChangeRef = useRef(null)
  const hashBlockRef = useRef(null)
  const navigateToHashRef = useRef(null)
  const navVersionRef = useRef(0)
  const clearDeepLinkTargetTimerRef = useRef(null)
  const pendingTargetRef = useRef(null)
  const savedSelectionRef = useRef(readStoredSelection())
  const [initialNavReady, setInitialNavReady] = useState(false)
  const [pendingTarget, setPendingTarget] = useState(null)

  const clearPendingTarget = useCallback(() => {
    if (clearDeepLinkTargetTimerRef.current) {
      clearTimeout(clearDeepLinkTargetTimerRef.current)
      clearDeepLinkTargetTimerRef.current = null
    }
    pendingTargetRef.current = null
    setPendingTarget(null)
  }, [])

  const clearPendingTargetAfterDeepLinkScroll = useCallback((target) => {
    if (clearDeepLinkTargetTimerRef.current) {
      clearTimeout(clearDeepLinkTargetTimerRef.current)
    }
    clearDeepLinkTargetTimerRef.current = setTimeout(() => {
      clearDeepLinkTargetTimerRef.current = null
      if (!sameNavigationTarget(pendingTargetRef.current, target)) return
      pendingTargetRef.current = null
      setPendingTarget(null)
    }, 500)
  }, [])

  const setPendingTargetSafely = useCallback(
    (nextValue) => {
      if (!nextValue) {
        clearPendingTarget()
        return
      }
      const normalized = normalizeNavigationTarget(nextValue)
      const pending = pendingTargetRef.current
      if (isWeakerDescendantTarget(pending, normalized)) {
        return false
      }
      pendingTargetRef.current = normalized
      setPendingTarget(normalized)
      return true
    },
    [clearPendingTarget],
  )

  // When a hash/deep link resolves to a deleted/missing item, fall back to the
  // deepest still-existing ancestor (section → notebook → last good selection)
  // instead of stranding the user on a blank editor.
  const pickNavFallback = useCallback(
    (target) => {
      if (!target) return null
      if (target.sectionId) {
        const sec = sections.find((s) => s.id === target.sectionId)
        if (sec) return { notebookId: sec.notebook_id, sectionId: sec.id, pageId: null, blockId: null }
      }
      if (target.notebookId && notebooks.some((n) => n.id === target.notebookId)) {
        return { notebookId: target.notebookId, sectionId: null, pageId: null, blockId: null }
      }
      const saved = savedSelectionRef?.current
      if (saved?.notebookId && notebooks.some((n) => n.id === saved.notebookId)) {
        return {
          notebookId: saved.notebookId,
          sectionId: saved.sectionId ?? null,
          pageId: saved.pageId ?? null,
          blockId: null,
        }
      }
      return null
    },
    [notebooks, sections, savedSelectionRef],
  )

  const queueResolvedTarget = useCallback(
    (target, { hashMode = null } = {}) => {
      if (!target?.notebookId) return
      const normalized = normalizeNavigationTarget(target)
      if (!setPendingTargetSafely(normalized)) return
      if (hashMode) navIntentRef.current = hashMode
      if (normalized.pageId && normalized.blockId) {
        hashBlockRef.current = { pageId: normalized.pageId, blockId: normalized.blockId }
      } else {
        hashBlockRef.current = null
        clearDeepLinkHighlight()
      }
      if (normalized.pageId && normalized.sectionId) {
        void loadSectionPagesMeta?.(normalized.sectionId)
      }
    },
    [loadSectionPagesMeta, setPendingTargetSafely],
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
        const fallback = pickNavFallback(parsed)
        clearPendingTarget()
        if (fallback) {
          setMessage?.('That page no longer exists.')
          // Rewrite the URL to the fallback (replace) so the address bar isn't
          // left on a dead id and browser-back won't re-trigger it.
          queueResolvedTarget(fallback, { hashMode: 'replace' })
        } else {
          console.warn('[nav] resolveNavHierarchy returned null for hash=%s — navigation dropped', hash)
          setInitialNavReady(true)
        }
        return
      }

      queueResolvedTarget(resolved)
    },
    [clearPendingTarget, queueResolvedTarget, setDeepLinkFocusGuard, pickNavFallback, setMessage],
  )

  const selectNavigationTarget = useCallback(
    (target) => {
      setDeepLinkFocusGuard(false)
      const normalized = normalizeNavigationTarget(target)
      // Same-page click with no block anchor: nothing to do (Notesnook noteAlreadyOpened pattern)
      if (
        targetMatchesSelection(normalized, { activeNotebookId, activeSectionId, activeTrackerId }) &&
        !normalized.blockId
      ) {
        return
      }
      queueResolvedTarget(normalized, { hashMode: 'push' })
    },
    [queueResolvedTarget, setDeepLinkFocusGuard, activeNotebookId, activeSectionId, activeTrackerId],
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

  useEffect(() => () => {
    if (clearDeepLinkTargetTimerRef.current) {
      clearTimeout(clearDeepLinkTargetTimerRef.current)
      clearDeepLinkTargetTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset nav state when the session prop transitions to null
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

    const status = getNavigationTargetStatus({
      target: pendingTarget,
      notebooks,
      notebooksLoading,
      sections,
      sectionPageCache,
      sectionsLoading,
    })

    if (status.type === 'wait') return

    if (status.type === 'missing') {
      const fallback = pickNavFallback(pendingTarget)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- transition nav state when the resolved target is missing
      clearPendingTarget()
      setInitialNavReady(true)
      if (fallback) {
        setMessage?.('That page no longer exists.')
        queueResolvedTarget(fallback, { hashMode: 'replace' })
      }
      return
    }

    const selectionMatchesTarget =
      activeNotebookId === pendingTarget.notebookId &&
      activeSectionId === pendingTarget.sectionId &&
      activeTrackerId === pendingTarget.pageId

    if (!selectionMatchesTarget) {
      // Flush pending work before the complete hierarchy changes, then commit
      // notebook, section, and page together in one store update.
      if (activeTrackerId && activeTrackerId !== pendingTarget.pageId) {
        flushSaveForTracker?.(activeTrackerId)
      }
      selectTarget(pendingTarget)
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
      if (found) clearPendingTargetAfterDeepLinkScroll(pendingTarget)
    })
  }, [
    session,
    pendingTarget,
    notebooks,
    notebooksLoading,
    sections,
    sectionPageCache,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    sectionsLoading,
    editorReady,
    selectTarget,
    flushSaveForTracker,
    clearPendingTarget,
    clearPendingTargetAfterDeepLinkScroll,
    pickNavFallback,
    queueResolvedTarget,
    setMessage,
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
    const activeSectionEntry = activeSectionId ? getSectionPageEntry(sectionPageCache, activeSectionId) : null
    const activeSectionLoaded = activeSectionEntry?.status === SECTION_PAGE_STATUS.LOADED
    if (
      activeSectionId &&
      savedSelection?.sectionId === activeSectionId &&
      savedSelection.pageId &&
      !activeTrackerId &&
      (!activeSectionLoaded || activeSectionEntry.pages.length > 0)
    ) {
      return
    }
    if (activeNotebookId && sectionsLoading) return
    if (activeSectionId && !activeSectionLoaded) return
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
    sectionPageCache,
    sections.length,
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
    pendingTarget,
    selectNavigationTarget,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  }
}
