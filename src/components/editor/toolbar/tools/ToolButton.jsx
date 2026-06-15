import ToolButton from '../../ToolButton'
import { useToolbarContext } from '../ToolbarContext'

/** Thin ToolButton wrapper that injects ctx-driven defaults. */
export function Btn({ disabled, ...rest }) {
  const { isTouchOnly, hasTracker } = useToolbarContext()
  return (
    <ToolButton
      isTouchOnly={isTouchOnly}
      disabled={disabled ?? !hasTracker}
      {...rest}
    />
  )
}
