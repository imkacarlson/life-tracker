import { useEffect, useRef } from 'react'
import { isTouchOnlyDevice } from '../utils/device'

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
 * 3. selectionchange recovery — if the DOM selection is inside the editor but focus
 *    has fallen back to <body> (can happen after table ops, programmatic selections,
 *    or autosave UI updates), silently refocus the editor view.
 */
export function useEditorFocusRecovery({
  editor,
  isLoading,
  trackerSessionMode,
  deepLinkFocusGuard,
  deepLinkFocusGuardRef,
  touchNavigationGuard,
  pendingEditTapRef,
  suppressFocusRef,
}) {
  const previousDeepLinkFocusGuardRef = useRef(deepLinkFocusGuard)
  const previousTouchNavigationGuardRef = useRef(touchNavigationGuard)
  const pendingDesktopDeepLinkRecoveryRef = useRef(false)

  // Effect 1: touch guard / deep-link guard → enable/disable editing + focus routing
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isLoading || trackerSessionMode === 'settings') return
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
      editor.view.dom.blur()
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.view.dom.blur()
      })
      return
    }
    const tapIntent = pendingEditTapRef?.current
    let handledInEditorTap = false
    if (wasGuarded && tapIntent?.inEditor) {
      const pos = editor.view.posAtCoords({ left: tapIntent.left, top: tapIntent.top })
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
        if (!editor.isDestroyed) editor.view.focus()
      })
      return
    }
    editor.setEditable(true)
  }, [editor, isLoading, trackerSessionMode, deepLinkFocusGuard, touchNavigationGuard, pendingEditTapRef])

  // Effect 2: desktop deep-link click recovery
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isTouchOnlyDevice()) return
    const root = editor.view?.dom
    if (!root) return

    const handlePointerDown = (event) => {
      if (event.pointerType === 'touch') return
      if (!pendingDesktopDeepLinkRecoveryRef.current) return
      if (isLoading || trackerSessionMode === 'settings') return
      if (deepLinkFocusGuard || deepLinkFocusGuardRef.current) return
      if (editor.view.hasFocus()) {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }
      const activeTag = document.activeElement?.tagName
      if (activeTag && activeTag !== 'BODY' && activeTag !== 'HTML') {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (pos?.pos != null) editor.commands.setTextSelection(pos.pos)
      pendingDesktopDeepLinkRecoveryRef.current = false
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.view.focus()
      })
    }

    root.addEventListener('pointerdown', handlePointerDown, true)
    return () => root.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editor, isLoading, trackerSessionMode, deepLinkFocusGuard, deepLinkFocusGuardRef])

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
        const root = editor.view?.dom
        if (!root) return
        const selectionInEditor =
          (anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl))
        if (!selectionInEditor) return
        if (editor.view.hasFocus()) return
        const scrollX = window.scrollX
        const scrollY = window.scrollY
        editor.view.focus()
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
