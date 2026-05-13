import { useEffect } from 'react'

/**
 * Close a popup when the user clicks outside its anchor button + popup, or
 * presses Escape. No-op when `isOpen` is false. Each picker owns its own
 * instance — replaces the toolbar-wide mega-effect that previously juggled
 * five pickers in one handler.
 */
export function useOutsideClick({ isOpen, onClose, refs }) {
  useEffect(() => {
    if (!isOpen) return undefined

    const isInsideAnyRef = (target) =>
      refs.some((ref) => ref.current?.contains(target))

    const handleMouseDown = (event) => {
      if (isInsideAnyRef(event.target)) return
      onClose()
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
    // refs are mutable containers — reading .current at event time is correct;
    // including them in deps would force re-binding on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose])
}
