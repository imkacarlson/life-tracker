import { useEffect, useRef } from 'react'
import { attachToolButtonTouchGuard } from '../../utils/toolButtonTouchGuard'

// Shared toolbar button.
//
// Pieces that keep the editor selection alive when a button is tapped:
//   1. tabIndex={-1}             keep the button out of the focus order
//   2. mousedown preventDefault  block focus transfer to the button. mousedown
//                                also fires on touch (via the touch→mouse
//                                compatibility sequence) before the synthetic
//                                click, so a single capture-phase mousedown
//                                handler covers both pointer and touch.
//   3. plain onClick             runs the editor command (chain().focus().toggleX().run())
//
// Do NOT add a touchstart preventDefault here. On Android Chrome, canceling
// touchstart suppresses the synthetic click that would otherwise follow
// touchend — which silently breaks every button that activates via onClick
// (most visibly the toolbar expand/collapse toggle). See
// src/utils/toolButtonTouchGuard.js for the canonical guard and its tests.
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
    return attachToolButtonTouchGuard(ref.current, { isTouchOnly })
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
