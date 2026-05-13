import { TOOL_DEFINITIONS } from './tools'
import { useToolbarContext } from './ToolbarContext'

/**
 * Renders a single toolbar group: either a separator, or a row of tools.
 * Mobile-only tools are filtered out on desktop. Groups with a `visible(ctx)`
 * predicate that returns false are skipped entirely.
 */
function ToolbarGroup({ group, editor }) {
  const ctx = useToolbarContext()

  if (group.separator) return <div className="toolbar-separator" />
  if (group.visible && !group.visible(ctx)) return null

  const toolIds = group.tools.filter((id) => {
    const def = TOOL_DEFINITIONS[id]
    if (!def) return false
    if (def.mobileOnly && !ctx.isTouchOnly) return false
    return true
  })

  if (toolIds.length === 0) return null

  return (
    <div className="toolbar-group">
      {toolIds.map((id) => {
        const { Component } = TOOL_DEFINITIONS[id]
        return <Component key={id} editor={editor} />
      })}
    </div>
  )
}

export default ToolbarGroup
