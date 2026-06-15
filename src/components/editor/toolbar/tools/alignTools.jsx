import { AlignLeftIcon, AlignCenterIcon, AlignRightIcon } from '../../ToolbarIcons'
import { cmd } from '../toolHelpers'
import { Btn } from './ToolButton'

export function AlignLeftTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'left' })}
      onActivate={() => cmd(editor)?.setTextAlign('left').run()}
      title="Align left"
    >
      <AlignLeftIcon />
    </Btn>
  )
}

export function AlignCenterTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'center' })}
      onActivate={() => cmd(editor)?.setTextAlign('center').run()}
      title="Align center"
    >
      <AlignCenterIcon />
    </Btn>
  )
}

export function AlignRightTool({ editor }) {
  return (
    <Btn
      active={editor?.isActive({ textAlign: 'right' })}
      onActivate={() => cmd(editor)?.setTextAlign('right').run()}
      title="Align right"
    >
      <AlignRightIcon />
    </Btn>
  )
}
