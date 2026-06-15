import { useMemo, useRef, useState } from 'react'
import { AiIcon } from '../../ToolbarIcons'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import AiDailyPicker from '../AiDailyPicker'
import { useToolbarContext } from '../ToolbarContext'
import { useOutsideClick } from '../useOutsideClick'
import { Btn } from './ToolButton'

export function AiDailyTool() {
  const { hasTracker, onAiDailyGenerate } = useToolbarContext()
  const aiLoading = useEditorUIStore((s) => s.aiLoading)
  const aiInsertLoading = useEditorUIStore((s) => s.aiInsertLoading)
  const aiDailyDate = useEditorUIStore((s) => s.aiDailyDate)
  const setAiDailyDate = useEditorUIStore((s) => s.setAiDailyDate)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickerRef = useRef(null)
  const refs = useMemo(() => [wrapRef, pickerRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const shiftDay = (delta) => {
    setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + delta)
      return next
    })
  }

  const onDateChange = (dateString) => {
    const parsed = new Date(dateString + 'T00:00:00')
    if (!isNaN(parsed.getTime())) setAiDailyDate(parsed)
  }

  const disabled = !hasTracker || aiLoading || aiInsertLoading

  return (
    <div className="ai-daily-control" ref={wrapRef}>
      <Btn
        disabled={disabled}
        className="toolbar-btn-ai"
        onActivate={onAiDailyGenerate}
        title={aiLoading ? 'Generating...' : 'AI Daily'}
        ariaLabel="AI Daily"
      >
        <AiIcon />
        <span className="toolbar-btn-label toolbar-btn-ai-label">
          {aiLoading ? '...' : 'AI'}
        </span>
      </Btn>
      <Btn
        disabled={disabled}
        className="toolbar-btn-caret"
        onActivate={() => setOpen((prev) => !prev)}
        ariaLabel="Pick date for AI Daily"
      >
        ▾
      </Btn>
      {open && (
        <AiDailyPicker
          pickerRef={pickerRef}
          date={aiDailyDate}
          onPrevDay={() => shiftDay(-1)}
          onNextDay={() => shiftDay(1)}
          onDateChange={onDateChange}
        />
      )}
    </div>
  )
}

export function AiInsertTool() {
  const { hasTracker, showAiInsert } = useToolbarContext()
  const aiLoading = useEditorUIStore((s) => s.aiLoading)
  const aiInsertLoading = useEditorUIStore((s) => s.aiInsertLoading)
  const setAiInsertOpen = useEditorUIStore((s) => s.setAiInsertOpen)
  if (!showAiInsert) return null
  return (
    <Btn
      disabled={!hasTracker || aiLoading || aiInsertLoading}
      className="toolbar-btn-ai"
      onActivate={() => setAiInsertOpen(true)}
      title={aiInsertLoading ? 'Inserting...' : 'AI Insert'}
      ariaLabel="AI Insert"
    >
      <AiIcon />
      <span className="toolbar-btn-label toolbar-btn-ai-label">
        {aiInsertLoading ? '...' : '⊕'}
      </span>
    </Btn>
  )
}
