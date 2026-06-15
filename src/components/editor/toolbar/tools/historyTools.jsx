import { UndoIcon, RedoIcon, ExportIcon, CopyIcon } from '../../ToolbarIcons'
import { serializeDocForExport } from '../../../../lib/serializeDocForExport'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import { useToolbarContext } from '../ToolbarContext'
import { cmd } from '../toolHelpers'
import { Btn } from './ToolButton'

// --- History --------------------------------------------------------------

export function UndoTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.undo().run()}
      title="Undo"
      testId="toolbar-undo"
    >
      <UndoIcon />
    </Btn>
  )
}

export function RedoTool({ editor }) {
  return (
    <Btn
      onActivate={() => cmd(editor)?.redo().run()}
      title="Redo"
    >
      <RedoIcon />
    </Btn>
  )
}

// --- Export / Copy --------------------------------------------------------

export function ExportTool({ editor }) {
  const { hasTracker, title } = useToolbarContext()
  const handleExport = () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'
    const doc = editor.getJSON()
    const text = serializeDocForExport(doc, rawTitle)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeTitle}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  return (
    <Btn onActivate={handleExport} title="Export">
      <ExportIcon />
    </Btn>
  )
}

export function CopyTool({ editor }) {
  const { hasTracker, title } = useToolbarContext()
  const copyLabel = useEditorUIStore((s) => s.copyLabel)
  const setCopyLabel = useEditorUIStore((s) => s.setCopyLabel)
  const handleCopy = async () => {
    if (!editor || !hasTracker) return
    const rawTitle = title?.trim() || 'Untitled'
    const doc = editor.getJSON()
    const text = serializeDocForExport(doc, rawTitle)
    try {
      await navigator.clipboard.writeText(text)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    } catch {
      window.alert('Failed to copy to clipboard.')
    }
  }
  return (
    <Btn onActivate={handleCopy} title={copyLabel} ariaLabel="Copy text">
      <CopyIcon />
    </Btn>
  )
}
