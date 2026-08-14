import ToolButton from '../../ToolButton'
import { useToolbarContext } from '../ToolbarContext'

/** Thin ToolButton wrapper that injects ctx-driven defaults. */
export function Btn({ disabled, ...rest }) {
  const { isTouchOnly, hasEditorTarget } = useToolbarContext()
  return (
    <ToolButton
      isTouchOnly={isTouchOnly}
      disabled={disabled ?? !hasEditorTarget}
      {...rest}
    />
  )
}
