import { useEffect, useRef } from 'react'
import { isTouchOnlyDevice } from '../utils/device'
import { getMountedEditorView } from '../utils/editorView'

/**
 * Manages three focus-recovery behaviours for the Tiptap editor:
 *
 * 1. Touch/deep-link guard — when deepLinkFocusGuard or touchNavigationGuard is
 *    active on a touch device, keep the editor non-editable (prevents keyboard
 *    from opening during navigation). Re-enables and routes focus once guards clear.
 *
 * 2. Desktop deep-link click recovery (issue #61) — when a deep-link highlight is
 *    cleared by a click outside the editor, restore focus/caret on the next
 *    in-editor pointer-down.
 *
 *    The same effect also keeps the editor non-editable while `resumeSyncing` is
 *    true (the app just came back to the foreground and is checking for edits
 *    made on another device), so you can't type into a stale copy of the page.
 *
 * 3. selectionchange recovery — if the DOM selection is inside the editor but focus
 *    has fallen back to <body> (can happen after table ops, programmatic selections,
 *    or autosave UI updates), silently refocus the editor view.
 */
export function useEditorFocusRecovery({
  editor,
  isLoading,
  editorSessionMode,
  deepLinkFocusGuard,
  deepLinkFocusGuardRef,
  touchNavigationGuard,
  pendingEditTapRef,
  suppressFocusRef,
  resumeSyncing = false,
}) {
  const previousDeepLinkFocusGuardRef = useRef(deepLinkFocusGuard)
  const previousTouchNavigationGuardRef = useRef(touchNavigationGuard)
  const pendingDesktopDeepLinkRecoveryRef = useRef(false)
  // Whether the editor had focus when the resume lock kicked in, so desktop can
  // put the caret back once it lifts.
  const focusedBeforeResumeLockRef = useRef(false)
  const resumeLockedRef = useRef(false)

  // Effect 1: touch guard / deep-link guard → enable/disable editing + focus routing
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isLoading || editorSessionMode === 'settings') return
    const isTouchDevice = isTouchOnlyDevice()
    const wasGuarded =
      previousDeepLinkFocusGuardRef.current || previousTouchNavigationGuardRef.current
    previousDeepLinkFocusGuardRef.current = deepLinkFocusGuard
    previousTouchNavigationGuardRef.current = touchNavigationGuard
    const suppressProgrammaticFocus =
      isTouchDevice && (deepLinkFocusGuard || touchNavigationGuard)
    if (suppressProgrammaticFocus) {
      pendingDesktopDeepLinkRecoveryRef.current = false
      editor.setEditable(false)
      getMountedEditorView(editor)?.dom.blur()
      requestAnimationFrame(() => {
        getMountedEditorView(editor)?.dom.blur()
      })
      return
    }
    // The lock and unlock pass emitUpdate=false: an 'update' event triggers
    // autosave, which here would queue a save of the stale copy we are guarding.
    if (resumeSyncing) {
      if (!resumeLockedRef.current) {
        resumeLockedRef.current = true
        focusedBeforeResumeLockRef.current = Boolean(getMountedEditorView(editor)?.hasFocus())
      }
      editor.setEditable(false, false)
      return
    }
    if (resumeLockedRef.current) {
      resumeLockedRef.current = false
      editor.setEditable(true, false)
      // Desktop gets its caret back. Touch skips this: refocusing would pop the
      // keyboard back open.
      if (focusedBeforeResumeLockRef.current && !isTouchDevice) {
        requestAnimationFrame(() => {
          getMountedEditorView(editor)?.focus()
        })
      }
      focusedBeforeResumeLockRef.current = false
      return
    }
    const tapIntent = pendingEditTapRef?.current
    let handledInEditorTap = false
    if (wasGuarded && tapIntent?.inEditor) {
      const view = getMountedEditorView(editor)
      const pos = view?.posAtCoords({ left: tapIntent.left, top: tapIntent.top })
      if (pos?.pos != null) editor.commands.setTextSelection(pos.pos)
      handledInEditorTap = true
    }
    if (wasGuarded) {
      pendingDesktopDeepLinkRecoveryRef.current = !isTouchDevice && !handledInEditorTap
      pendingEditTapRef.current = null
    }
    if (handledInEditorTap) {
      editor.setEditable(true)
      requestAnimationFrame(() => {
        getMountedEditorView(editor)?.focus()
      })
      return
    }
    editor.setEditable(true)
  }, [editor, isLoading, editorSessionMode, deepLinkFocusGuard, touchNavigationGuard, pendingEditTapRef, resumeSyncing])

  // Effect 2: desktop deep-link click recovery
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isTouchOnlyDevice()) return
    const root = getMountedEditorView(editor)?.dom
    if (!root) return

    const handlePointerDown = (event) => {
      if (event.pointerType === 'touch') return
      if (!pendingDesktopDeepLinkRecoveryRef.current) return
      if (isLoading || editorSessionMode === 'settings') return
      if (deepLinkFocusGuard || deepLinkFocusGuardRef.current) return
      const view = getMountedEditorView(editor)
      if (!view) return
      if (view.hasFocus()) {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }
      const activeTag = document.activeElement?.tagName
      if (activeTag && activeTag !== 'BODY' && activeTag !== 'HTML') {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (pos?.pos != null) editor.commands.setTextSelection(pos.pos)
      pendingDesktopDeepLinkRecoveryRef.current = false
      requestAnimationFrame(() => {
        getMountedEditorView(editor)?.focus()
      })
    }

    root.addEventListener('pointerdown', handlePointerDown, true)
    return () => root.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editor, isLoading, editorSessionMode, deepLinkFocusGuard, deepLinkFocusGuardRef])

  // Effect 3: selectionchange → restore focus when it fell back to <body>
  useEffect(() => {
    if (!editor) return
    const isTouchDevice = isTouchOnlyDevice()
    let raf = null
    const handleSelectionChange = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        if (!editor || editor.isDestroyed) return
        if (isLoading) return
        if (suppressFocusRef.current) return
        // On touch devices native tap-to-focus handles this; programmatic recovery
        // here would open the keyboard on every non-focusable tap.
        if (isTouchDevice) return
        const activeTag = document.activeElement?.tagName
        if (activeTag && activeTag !== 'BODY' && activeTag !== 'HTML') return
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return
        const sel = window.getSelection?.()
        if (!sel || sel.rangeCount === 0) return
        const anchorNode = sel.anchorNode
        const focusNode = sel.focusNode
        const anchorEl = anchorNode
          ? anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement
          : null
        const focusEl = focusNode
          ? focusNode.nodeType === 1 ? focusNode : focusNode.parentElement
          : null
        const view = getMountedEditorView(editor)
        if (!view) return
        const root = view.dom
        const selectionInEditor =
          (anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl))
        if (!selectionInEditor) return
        if (view.hasFocus()) return
        const scrollX = window.scrollX
        const scrollY = window.scrollY
        view.focus()
        requestAnimationFrame(() => window.scrollTo(scrollX, scrollY))
      })
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [editor, isLoading, deepLinkFocusGuard, suppressFocusRef])
}
