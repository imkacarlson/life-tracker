import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { expandSelectionToBlock } from './blockSelectionHelper'
import { isTouchOnlyDevice } from '../../utils/device'

const MOVE_THRESHOLD_PX = 10
const TOUCH_WINDOW_MS = 600

const mobileLongPressSelectKey = new PluginKey('mobileLongPressSelect')

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
          let expandedThisTouch = false
          let rafId = null

          const resetTouch = () => {
            touchStartTime = 0
            startX = 0
            startY = 0
            touchMoved = false
            expandedThisTouch = false
          }

          const onTouchStart = (event) => {
            if (!event.touches || event.touches.length !== 1) {
              resetTouch()
              return
            }

            const touch = event.touches[0]
            touchStartTime = Date.now()
            startX = touch.clientX
            startY = touch.clientY
            touchMoved = false
            expandedThisTouch = false
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

          // On Android, touchcancel fires when the browser's native long-press word
          // selection kicks in — that's exactly our trigger. On iOS, selectionchange
          // fires after touchend. Both need touch state preserved so onSelectionChange
          // can act; state resets on the next onTouchStart or via TOUCH_WINDOW_MS.
          const onTouchEnd = () => {}
          const onTouchCancel = () => {}

          const onSelectionChange = () => {
            if (!touchStartTime) return
            if (touchMoved) return
            if (expandedThisTouch) return
            if (Date.now() - touchStartTime > TOUCH_WINDOW_MS) return

            const domSelection = doc.getSelection?.()
            if (!domSelection || domSelection.isCollapsed) return

            const anchorInside =
              domSelection.anchorNode !== null && view.dom.contains(domSelection.anchorNode)
            const focusInside =
              domSelection.focusNode !== null && view.dom.contains(domSelection.focusNode)
            if (!anchorInside && !focusInside) return

            expandedThisTouch = true

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
            },
          }
        },
      }),
    ]
  },
})
