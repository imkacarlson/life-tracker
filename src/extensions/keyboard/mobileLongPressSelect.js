import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { expandSelectionToBlock } from './blockSelectionHelper'

const LONG_PRESS_MS = 400
const MOVE_THRESHOLD_PX = 10
const EXPAND_WINDOW_MS = 300

const mobileLongPressSelectKey = new PluginKey('mobileLongPressSelect')

const isTouchOnlyDevice = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  const hasCoarsePointer = window.matchMedia('(any-pointer: coarse)').matches
  const hasFinePointer = window.matchMedia('(any-pointer: fine)').matches
  const hasHover =
    window.matchMedia('(any-hover: hover)').matches || window.matchMedia('(hover: hover)').matches

  return hasCoarsePointer && !hasFinePointer && !hasHover
}

export const MobileLongPressSelect = Extension.create({
  name: 'mobileLongPressSelect',

  addProseMirrorPlugins() {
    if (!isTouchOnlyDevice()) return []

    const editor = this.editor

    return [
      new Plugin({
        key: mobileLongPressSelectKey,
        view(view) {
          const doc = view.dom.ownerDocument
          const win = doc.defaultView

          let touchStartTime = 0
          let startX = 0
          let startY = 0
          let touchMoved = false
          let pendingExpand = false
          let pendingTimeoutId = null
          let rafId = null

          const clearPendingExpand = () => {
            pendingExpand = false
            if (pendingTimeoutId !== null) {
              win?.clearTimeout(pendingTimeoutId)
              pendingTimeoutId = null
            }
          }

          const resetTouch = () => {
            touchStartTime = 0
            startX = 0
            startY = 0
            touchMoved = false
          }

          const scheduleExpandWindow = () => {
            clearPendingExpand()
            pendingExpand = true
            pendingTimeoutId = win?.setTimeout(() => {
              pendingExpand = false
              pendingTimeoutId = null
            }, EXPAND_WINDOW_MS)
          }

          const onTouchStart = (event) => {
            if (!event.touches || event.touches.length !== 1) {
              resetTouch()
              clearPendingExpand()
              return
            }

            const touch = event.touches[0]
            touchStartTime = Date.now()
            startX = touch.clientX
            startY = touch.clientY
            touchMoved = false
            clearPendingExpand()
          }

          const onTouchMove = (event) => {
            if (!touchStartTime || !event.touches || event.touches.length === 0) return

            const touch = event.touches[0]
            const dx = touch.clientX - startX
            const dy = touch.clientY - startY
            if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
              touchMoved = true
            }
          }

          const onTouchEnd = () => {
            if (!touchStartTime) return

            const heldMs = Date.now() - touchStartTime
            if (heldMs >= LONG_PRESS_MS && !touchMoved) {
              scheduleExpandWindow()
            } else {
              clearPendingExpand()
            }

            resetTouch()
          }

          const onTouchCancel = () => {
            resetTouch()
            clearPendingExpand()
          }

          const onSelectionChange = () => {
            if (!pendingExpand) return

            const { selection } = editor.state
            if (selection.empty) return

            const domSelection = doc.getSelection?.()
            if (!domSelection || domSelection.isCollapsed) return

            const anchorInside =
              domSelection.anchorNode !== null && view.dom.contains(domSelection.anchorNode)
            const focusInside =
              domSelection.focusNode !== null && view.dom.contains(domSelection.focusNode)
            if (!anchorInside && !focusInside) return

            clearPendingExpand()

            if (rafId !== null) {
              if (typeof win?.cancelAnimationFrame === 'function') {
                win.cancelAnimationFrame(rafId)
              } else {
                win?.clearTimeout(rafId)
              }
              rafId = null
            }

            if (typeof win?.requestAnimationFrame === 'function') {
              rafId = win.requestAnimationFrame(() => {
                rafId = null
                expandSelectionToBlock(editor)
              })
            } else {
              rafId = win?.setTimeout(() => {
                rafId = null
                expandSelectionToBlock(editor)
              }, 0)
            }
          }

          view.dom.addEventListener('touchstart', onTouchStart, { passive: true })
          view.dom.addEventListener('touchmove', onTouchMove, { passive: true })
          view.dom.addEventListener('touchend', onTouchEnd, { passive: true })
          view.dom.addEventListener('touchcancel', onTouchCancel, { passive: true })
          doc.addEventListener('selectionchange', onSelectionChange)

          return {
            destroy() {
              view.dom.removeEventListener('touchstart', onTouchStart)
              view.dom.removeEventListener('touchmove', onTouchMove)
              view.dom.removeEventListener('touchend', onTouchEnd)
              view.dom.removeEventListener('touchcancel', onTouchCancel)
              doc.removeEventListener('selectionchange', onSelectionChange)
              if (rafId !== null) {
                if (typeof win?.cancelAnimationFrame === 'function') {
                  win.cancelAnimationFrame(rafId)
                } else {
                  win?.clearTimeout(rafId)
                }
              }
              clearPendingExpand()
            },
          }
        },
      }),
    ]
  },
})
