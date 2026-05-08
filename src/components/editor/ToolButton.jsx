import { useEffect, useRef } from 'react'

// Shared toolbar button.
//
// Why this exists: on mobile, tapping a plain <button> inside a contenteditable
// toolbar makes the browser pull focus off the editor before the click handler
// runs. That collapses the text selection (so toggleItalic ends up a no-op)
// and dismisses the on-screen keyboard. Pattern mirrors notesnook's
// packages/editor/src/toolbar/components/tool-button.tsx:
//
//   1. tabIndex={-1}            keep the button out of the focus order
//   2. onMouseDown preventDefault    stop focus transfer on touch
//   3. capture-phase native listener belt-and-braces in case anything
//                                    synthesizes its own pointer handling
//   4. plain onClick runs the editor command (chain().focus().toggleX().run())
function ToolButton({
  active = false,
  disabled = false,
  isTouchOnly = false,
  onActivate,
  title,
  ariaLabel,
  className = '',
  children,
  buttonRef,
  testId,
  ...rest
}) {
  const localRef = useRef(null)
  const ref = buttonRef ?? localRef

  useEffect(() => {
    const el = ref.current
    if (!el || !isTouchOnly) return undefined
    const onDown = (e) => { e.preventDefault() }
    el.addEventListener('mousedown', onDown, { capture: true, passive: false })
    el.addEventListener('touchstart', onDown, { capture: true, passive: false })
    return () => {
      el.removeEventListener('mousedown', onDown, { capture: true })
      el.removeEventListener('touchstart', onDown, { capture: true })
    }
  }, [isTouchOnly, ref])

  const composedClassName = `toolbar-btn${active ? ' active' : ''}${className ? ` ${className}` : ''}`

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      className={composedClassName}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      data-testid={testId}
      onMouseDown={(e) => { if (isTouchOnly) e.preventDefault() }}
      onClick={(e) => {
        if (disabled) return
        e.preventDefault()
        onActivate?.(e)
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

export default ToolButton
