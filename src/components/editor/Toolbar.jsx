import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toggleLineStrike } from '../../extensions/keyboard/toggleLineStrike'
import FindBar from './FindBar'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon,
  HighlightIcon, TextColorIcon,
  BulletListIcon, OrderedListIcon, TaskListIcon,
  AlignLeftIcon, AlignCenterIcon, AlignRightIcon,
  LinkIcon, UnlinkIcon, ImageIcon,
  TableIcon, AddRowIcon, AddColIcon, DeleteTableIcon, ShadingIcon,
  UndoIcon, RedoIcon,
  SearchIcon, ExportIcon, CopyIcon, MoreIcon, AiIcon,
  IndentIcon, OutdentIcon,
} from './ToolbarIcons'

function Toolbar({
  editor,
  hasTracker,
  controlsDisabled,
  isTouchOnly,
  toolbarExpanded,
  setToolbarExpanded,
  // Editor interaction handlers (stay in EditorPanel)
  handleSetLink,
  handleSetTextAlign,
  handleExportText,
  handleCopyText,
  handleGenerateToday,
  handlePickImage,
  handleFileChange,
  handleIndent,
  handleOutdent,
  handleCopyLinkFromToolbar,
  handleSetTrackerFromToolbar,
  // Derived state
  isInList,
  inTable,
  copyLabel,
  aiLoading,
  aiInsertLoading,
  showAiDaily,
  showAiInsert,
  toolbarDeepLinkHash,
  isCurrentPageTracker,
  trackerPageSaving,
  onSetTrackerPage,
  contextMenuItems,
  // Find
  findOpen,
  findQuery,
  findStatus,
  findInputRef,
  openFind,
  closeFind,
  handleFindQueryChange,
  handleFindPrev,
  handleFindNext,
  // AI insert opener
  setAiInsertOpen,
  // File input ref
  fileInputRef,
  // AI daily date handlers
  handleAiDailyPrevDay,
  handleAiDailyNextDay,
  handleAiDailyDateChange,
  aiDailyDate,
  // Table insert
  handleInsertTable,
  // Shading
  shadingColor,
  handleApplyShading,
  handlePickShading,
  openCustomShading,
  handleCustomShading,
  shadingInputRef,
  // Highlight
  highlightColor,
  handleApplyHighlight,
  handlePickHighlight,
  // Theme/standard colors for shading picker
  themeRows,
  standardColors,
  // Highlight colors
  highlightColors,
}) {
  const highlightButtonRef = useRef(null)
  const highlightPickerRef = useRef(null)
  const shadingButtonRef = useRef(null)
  const shadingPickerRef = useRef(null)
  const tableButtonRef = useRef(null)
  const tablePickerRef = useRef(null)
  const aiDailyButtonRef = useRef(null)
  const aiDailyPickerRef = useRef(null)
  const moreMenuRef = useRef(null)

  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false)
  const [shadingPickerOpen, setShadingPickerOpen] = useState(false)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 })
  const [aiDailyPickerOpen, setAiDailyPickerOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const gridSize = 5

  const tableGrid = useMemo(() => {
    return Array.from({ length: gridSize }, (_, rowIndex) =>
      Array.from({ length: gridSize }, (_, colIndex) => ({
        row: rowIndex + 1,
        col: colIndex + 1,
      })),
    )
  }, [gridSize])

  const closeTablePicker = useCallback(() => setTablePickerOpen(false), [])

  // Outside click and escape handlers for pickers
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (tablePickerOpen) {
        const picker = tablePickerRef.current
        const button = tableButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setTablePickerOpen(false)
      }
      if (highlightPickerOpen) {
        const picker = highlightPickerRef.current
        const button = highlightButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setHighlightPickerOpen(false)
      }
      if (shadingPickerOpen) {
        const picker = shadingPickerRef.current
        const button = shadingButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setShadingPickerOpen(false)
      }
      if (aiDailyPickerOpen) {
        const picker = aiDailyPickerRef.current
        const button = aiDailyButtonRef.current
        if (picker?.contains(event.target) || button?.contains(event.target)) return
        setAiDailyPickerOpen(false)
      }
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreMenuOpen(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTablePickerOpen(false)
        setHighlightPickerOpen(false)
        setShadingPickerOpen(false)
        setAiDailyPickerOpen(false)
        setMoreMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [tablePickerOpen, highlightPickerOpen, shadingPickerOpen, aiDailyPickerOpen, moreMenuOpen])

  const onInsertTable = (rows, cols) => {
    handleInsertTable(rows, cols)
    closeTablePicker()
  }

  const onPickHighlight = (color) => {
    handlePickHighlight(color)
    setHighlightPickerOpen(false)
  }

  const onPickShading = (color) => {
    handlePickShading(color)
    setShadingPickerOpen(false)
  }

  const onCopyLinkFromToolbar = async () => {
    await handleCopyLinkFromToolbar()
    setMoreMenuOpen(false)
  }

  const onSetTrackerFromToolbar = async () => {
    await handleSetTrackerFromToolbar()
    setMoreMenuOpen(false)
  }

  return (
    <div
      className={`toolbar${controlsDisabled ? ' disabled' : ''}${isTouchOnly && !toolbarExpanded ? ' toolbar-collapsed' : ''}`}
      data-expanded={!isTouchOnly || toolbarExpanded ? 'true' : 'false'}
      onMouseDownCapture={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button')) {
          event.preventDefault()
        }
      }}
    >
      <div className="toolbar-core">
        {/* Text formatting group */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('bold') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!hasTracker}
            title="Bold"
            aria-label="Bold"
          >
            <BoldIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('italic') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!hasTracker}
            title="Italic"
            aria-label="Italic"
          >
            <ItalicIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('heading', { level: 1 }) ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={!hasTracker}
            title="Heading 1"
            aria-label="Heading 1"
          >
            <span className="toolbar-btn-label">H1</span>
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('bulletList') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={!hasTracker}
            title="Bullet list"
            aria-label="Bullet list"
          >
            <BulletListIcon />
          </button>
        </div>

        {/* Link + Undo group */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleSetLink}
            disabled={!hasTracker}
            title="Link"
            aria-label="Insert link"
          >
            <LinkIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!hasTracker}
            title="Undo"
            aria-label="Undo"
            data-testid="toolbar-undo"
          >
            <UndoIcon />
          </button>
        </div>

        {/* Mobile expand toggle */}
        {isTouchOnly && (
          <button
            type="button"
            className="toolbar-expand-toggle"
            onClick={() => setToolbarExpanded((prev) => !prev)}
            aria-label={toolbarExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
            data-testid="toolbar-expand-toggle"
          >
            {toolbarExpanded ? '▴' : '▾'}
          </button>
        )}
      </div>

      <div className="toolbar-extra">
        {/* Extended text formatting */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('underline') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={!hasTracker}
            title="Underline"
            aria-label="Underline"
          >
            <UnderlineIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('strike') ? ' active' : ''}`}
            onClick={() => editor && toggleLineStrike(editor)}
            disabled={!hasTracker}
            title="Strikethrough"
            aria-label="Toggle strikethrough"
            data-testid="toolbar-strikethrough"
          >
            <StrikethroughIcon />
          </button>
          <div className="highlight-control" ref={highlightButtonRef}>
            <button
              type="button"
              className={`toolbar-btn${editor?.isActive('highlight') ? ' active' : ''}`}
              onClick={handleApplyHighlight}
              disabled={!hasTracker}
              title="Highlight"
              aria-label="Highlight"
            >
              <HighlightIcon />
              <span
                className="toolbar-color-bar"
                style={{ backgroundColor: highlightColor ?? 'transparent' }}
              />
            </button>
            <button
              type="button"
              className="toolbar-btn toolbar-btn-caret"
              onClick={() => setHighlightPickerOpen((prev) => !prev)}
              disabled={!hasTracker}
              aria-label="Highlight colors"
            >
              ▾
            </button>
            {highlightPickerOpen && (
              <div className="highlight-picker" ref={highlightPickerRef}>
                <div className="highlight-grid">
                  {highlightColors.flatMap((row) =>
                    row.map((swatch) => (
                      <button
                        key={swatch.label}
                        type="button"
                        className="highlight-swatch"
                        style={{ backgroundColor: swatch.value }}
                        onClick={() => onPickHighlight(swatch.value)}
                        aria-label={swatch.label}
                      />
                    )),
                  )}
                </div>
                <button type="button" className="highlight-none" onClick={() => onPickHighlight(null)}>
                  No Color
                </button>
              </div>
            )}
          </div>
          <input
            type="color"
            aria-label="Text color"
            className="toolbar-color-input"
            onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
            disabled={!hasTracker}
          />
        </div>

        {/* Headings + Lists */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={!hasTracker}
            title="Heading 2"
            aria-label="Heading 2"
          >
            <span className="toolbar-btn-label">H2</span>
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('orderedList') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={!hasTracker}
            title="Numbered list"
            aria-label="Numbered list"
          >
            <OrderedListIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive('taskList') ? ' active' : ''}`}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            disabled={!hasTracker}
            title="Task list"
            aria-label="Task list"
          >
            <TaskListIcon />
          </button>
          {isTouchOnly && (
            <>
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleOutdent}
                disabled={!hasTracker || !isInList}
                title="Outdent"
                aria-label="Outdent list item"
                data-testid="toolbar-outdent"
              >
                <OutdentIcon />
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleIndent}
                disabled={!hasTracker || !isInList}
                title="Indent"
                aria-label="Indent list item"
                data-testid="toolbar-indent"
              >
                <IndentIcon />
              </button>
            </>
          )}
        </div>

        {/* Alignment */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'left' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('left')}
            disabled={!hasTracker}
            title="Align left"
            aria-label="Align left"
          >
            <AlignLeftIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'center' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('center')}
            disabled={!hasTracker}
            title="Align center"
            aria-label="Align center"
          >
            <AlignCenterIcon />
          </button>
          <button
            type="button"
            className={`toolbar-btn${editor?.isActive({ textAlign: 'right' }) ? ' active' : ''}`}
            onClick={() => handleSetTextAlign('right')}
            disabled={!hasTracker}
            title="Align right"
            aria-label="Align right"
          >
            <AlignRightIcon />
          </button>
        </div>

        <div className="toolbar-separator" />

        {/* Insert group */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().unsetLink().run()}
            disabled={!hasTracker}
            title="Unlink"
            aria-label="Remove link"
          >
            <UnlinkIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handlePickImage}
            disabled={!hasTracker}
            title="Image"
            aria-label="Insert image"
          >
            <ImageIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="file-input"
          />
          <div className="table-picker-wrap">
            <button
              type="button"
              className="toolbar-btn"
              ref={tableButtonRef}
              onClick={() => setTablePickerOpen((prev) => !prev)}
              disabled={!hasTracker}
              title="Table"
              aria-label="Insert table"
            >
              <TableIcon />
            </button>
            {tablePickerOpen && (
              <div
                className="table-picker-backdrop"
                onClick={closeTablePicker}
                aria-hidden="true"
              />
            )}
            {tablePickerOpen && (
              <div className="table-picker" ref={tablePickerRef}>
                <div className="table-picker-grid">
                  {tableGrid.map((row) =>
                    row.map((cell) => {
                      const isActive =
                        cell.row <= tableSize.rows && cell.col <= tableSize.cols
                      return (
                        <div
                          key={`${cell.row}-${cell.col}`}
                          className={`table-picker-cell ${isActive ? 'active' : ''}`}
                          onMouseEnter={() => setTableSize({ rows: cell.row, cols: cell.col })}
                          onClick={() => onInsertTable(cell.row, cell.col)}
                        />
                      )
                    }),
                  )}
                </div>
                <div className="table-picker-label">
                  {tableSize.rows} × {tableSize.cols}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().addRowAfter().run()}
            disabled={!hasTracker}
            title="Add row"
            aria-label="Add row"
          >
            <AddRowIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().addColumnAfter().run()}
            disabled={!hasTracker}
            title="Add column"
            aria-label="Add column"
          >
            <AddColIcon />
          </button>
          {inTable && (
            <div className="shading-control" ref={shadingButtonRef}>
              <button
                type="button"
                className={`toolbar-btn${shadingColor ? ' active' : ''}`}
                onClick={handleApplyShading}
                disabled={!hasTracker}
                title="Shading"
                aria-label="Cell shading"
              >
                <ShadingIcon />
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-caret"
                onClick={() => setShadingPickerOpen((prev) => !prev)}
                disabled={!hasTracker}
                aria-label="Shading colors"
              >
                ▾
              </button>
              {shadingPickerOpen && (
                <div className="shading-picker" ref={shadingPickerRef}>
                  <div className="shading-section">
                    <p className="shading-header">Theme Colors</p>
                    <div className="shading-grid">
                      {themeRows.map((row, rowIndex) =>
                        row.map((color, colIndex) => (
                          <button
                            key={`theme-${rowIndex}-${colIndex}`}
                            type="button"
                            className={`shading-swatch ${
                              shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                            }`}
                            style={{ backgroundColor: color }}
                            onClick={() => onPickShading(color)}
                            aria-label={`Theme color ${rowIndex + 1}-${colIndex + 1}`}
                          />
                        )),
                      )}
                    </div>
                  </div>
                  <div className="shading-section">
                    <p className="shading-header">Standard Colors</p>
                    <div className="shading-grid shading-grid-standard">
                      {standardColors.map((color, index) => (
                        <button
                          key={`standard-${color}`}
                          type="button"
                          className={`shading-swatch ${
                            shadingColor?.toLowerCase() === color.toLowerCase() ? 'active' : ''
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => onPickShading(color)}
                          aria-label={`Standard color ${index + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="shading-actions">
                    <button type="button" className="shading-action" onClick={() => onPickShading(null)}>
                      <span className="shading-icon" aria-hidden="true" />
                      No Color
                    </button>
                    <button type="button" className="shading-action" onClick={openCustomShading}>
                      <span className="shading-icon palette" aria-hidden="true" />
                      More Colors...
                    </button>
                    <input
                      ref={shadingInputRef}
                      type="color"
                      className="shading-input"
                      onChange={handleCustomShading}
                      aria-label="Custom shading color"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().deleteTable().run()}
            disabled={!hasTracker}
            title="Delete table"
            aria-label="Delete table"
          >
            <DeleteTableIcon />
          </button>
        </div>

        <div className="toolbar-separator" />

        {/* Undo/Redo + utilities */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!hasTracker}
            title="Redo"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleExportText}
            disabled={!hasTracker}
            title="Export"
            aria-label="Export"
          >
            <ExportIcon />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleCopyText}
            disabled={!hasTracker}
            title={copyLabel}
            aria-label="Copy text"
          >
            <CopyIcon />
          </button>
        </div>

        {/* AI group */}
        {showAiDaily && (
          <div className="toolbar-group">
            <div className="ai-daily-control" ref={aiDailyButtonRef}>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-ai"
                onClick={handleGenerateToday}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                title={aiLoading ? 'Generating...' : 'AI Daily'}
                aria-label="AI Daily"
              >
                <AiIcon />
                <span className="toolbar-btn-label toolbar-btn-ai-label">
                  {aiLoading ? '...' : 'AI'}
                </span>
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-caret"
                onClick={() => setAiDailyPickerOpen((prev) => !prev)}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                aria-label="Pick date for AI Daily"
              >
                ▾
              </button>
              {aiDailyPickerOpen && (
                <div className="ai-daily-picker" ref={aiDailyPickerRef}>
                  <div className="ai-daily-date-nav">
                    <button type="button" onClick={handleAiDailyPrevDay}>&#8249;</button>
                    <span className="ai-daily-date-label">
                      {aiDailyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <button type="button" onClick={handleAiDailyNextDay}>&#8250;</button>
                  </div>
                  <input
                    type="date"
                    value={aiDailyDate.toLocaleDateString('en-CA')}
                    onChange={(e) => handleAiDailyDateChange(e.target.value)}
                    className="ai-daily-date-input"
                  />
                </div>
              )}
            </div>
            {showAiInsert && (
              <button
                type="button"
                className="toolbar-btn toolbar-btn-ai"
                onClick={() => {
                  setAiDailyPickerOpen(false)
                  setAiInsertOpen(true)
                }}
                disabled={!hasTracker || aiLoading || aiInsertLoading}
                title={aiInsertLoading ? 'Inserting...' : 'AI Insert'}
                aria-label="AI Insert"
              >
                <AiIcon />
                <span className="toolbar-btn-label toolbar-btn-ai-label">
                  {aiInsertLoading ? '...' : '⊕'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Search + More */}
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={openFind}
            disabled={!hasTracker}
            title="Find"
            aria-label="Find in page"
          >
            <SearchIcon />
          </button>
          <div className="more-menu-wrap" ref={moreMenuRef}>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setMoreMenuOpen(prev => !prev)}
              disabled={!hasTracker}
              title="More"
              aria-label="More actions"
            >
              <MoreIcon />
            </button>
            {moreMenuOpen && (
              <>
                <div className="more-menu-backdrop" onClick={() => setMoreMenuOpen(false)} />
                <div className="more-menu">
                  <button
                    type="button"
                    className="table-context-item"
                    onClick={onCopyLinkFromToolbar}
                    disabled={!toolbarDeepLinkHash}
                  >
                    Copy link to paragraph
                  </button>
                  <button
                    type="button"
                    className="table-context-item"
                    onClick={onSetTrackerFromToolbar}
                    disabled={!hasTracker || isCurrentPageTracker || trackerPageSaving || !onSetTrackerPage}
                  >
                    {isCurrentPageTracker ? 'This page is the tracker page'
                      : trackerPageSaving ? 'Setting tracker page...'
                      : 'Set this page as tracker'}
                  </button>
                  {inTable && (
                    <>
                      <div className="more-menu-divider" />
                      {contextMenuItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          className="table-context-item"
                          onClick={() => { item.action(); setMoreMenuOpen(false) }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {findOpen && hasTracker && (
        <FindBar
          inputRef={findInputRef}
          findQuery={findQuery}
          findStatus={findStatus}
          onFindQueryChange={handleFindQueryChange}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={closeFind}
        />
      )}
    </div>
  )
}

export default Toolbar
