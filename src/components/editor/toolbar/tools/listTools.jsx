import {
  BulletListIcon, OrderedListIcon, TaskListIcon,
  IndentIcon, OutdentIcon,
} from '../../ToolbarIcons'
import { useToolbarContext } from '../ToolbarContext'
import { cmd, isInAnyList, useIndentOutdent } from '../toolHelpers'
import { Btn } from './ToolButton'

export function BulletListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('bulletList')}
      onActivate={() => cmd(editor)?.toggleBulletList().run()}
      title="Bullet list"
    >
      <BulletListIcon />
    </Btn>
  )
}

export function OrderedListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('orderedList')}
      onActivate={() => cmd(editor)?.toggleOrderedList().run()}
      title="Numbered list"
    >
      <OrderedListIcon />
    </Btn>
  )
}

export function TaskListTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive('taskList')}
      onActivate={() => cmd(editor)?.toggleTaskList().run()}
      title="Task list"
    >
      <TaskListIcon />
    </Btn>
  )
}

export function OutdentTool({ editor }) {
  const { hasTracker } = useToolbarContext()
  const { handleOutdent } = useIndentOutdent(editor)
  return (
    <Btn
      disabled={!hasTracker || !isInAnyList(editor)}
      onActivate={handleOutdent}
      title="Outdent"
      ariaLabel="Outdent list item"
      testId="toolbar-outdent"
    >
      <OutdentIcon />
    </Btn>
  )
}

export function IndentTool({ editor }) {
  const { hasTracker } = useToolbarContext()
  const { handleIndent } = useIndentOutdent(editor)
  return (
    <Btn
      disabled={!hasTracker || !isInAnyList(editor)}
      onActivate={handleIndent}
      title="Indent"
      ariaLabel="Indent list item"
      testId="toolbar-indent"
    >
      <IndentIcon />
    </Btn>
  )
}
