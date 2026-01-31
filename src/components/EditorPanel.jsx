import { useRef } from 'react'
import { EditorContent } from '@tiptap/react'

function EditorPanel({
  editor,
  title,
  onTitleChange,
  onDelete,
  saveStatus,
  onImageUpload,
  hasTracker,
  message,
}) {
  const fileInputRef = useRef(null)

  const handlePickImage = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      onImageUpload?.(file)
    }
    event.target.value = ''
  }

  const handleSetLink = () => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Paste a link URL', previousUrl || '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const handleSetTextAlign = (alignment) => {
    editor?.chain().focus().setTextAlign(alignment).run()
  }

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div>
          <input
            className="title-input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Tracker title"
            disabled={!hasTracker}
          />
          <div className="status-row">
            <span className="subtle">{hasTracker ? saveStatus : 'No tracker selected'}</span>
            {message && <span className="message-inline">{message}</span>}
          </div>
        </div>
        <button className="secondary" onClick={onDelete} disabled={!hasTracker}>
          Delete
        </button>
      </div>

      <div className={`toolbar ${!hasTracker ? 'disabled' : ''}`}>
        <button
          type="button"
          className={editor?.isActive('bold') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!hasTracker}
        >
          B
        </button>
        <button
          type="button"
          className={editor?.isActive('italic') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!hasTracker}
        >
          I
        </button>
        <button
          type="button"
          className={editor?.isActive('underline') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={!hasTracker}
        >
          U
        </button>
        <button
          type="button"
          className={editor?.isActive('strike') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          disabled={!hasTracker}
        >
          S
        </button>
        <button
          type="button"
          className={editor?.isActive('highlight') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}
          disabled={!hasTracker}
        >
          Highlight
        </button>
        <input
          type="color"
          aria-label="Text color"
          onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
          disabled={!hasTracker}
        />

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          disabled={!hasTracker}
        >
          H1
        </button>
        <button
          type="button"
          className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!hasTracker}
        >
          H2
        </button>
        <button
          type="button"
          className={editor?.isActive('bulletList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!hasTracker}
        >
          • List
        </button>
        <button
          type="button"
          className={editor?.isActive('orderedList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!hasTracker}
        >
          1. List
        </button>
        <button
          type="button"
          className={editor?.isActive('taskList') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
          disabled={!hasTracker}
        >
          ☑ List
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          className={editor?.isActive({ textAlign: 'left' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('left')}
          disabled={!hasTracker}
        >
          Left
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('center')}
          disabled={!hasTracker}
        >
          Center
        </button>
        <button
          type="button"
          className={editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}
          onClick={() => handleSetTextAlign('right')}
          disabled={!hasTracker}
        >
          Right
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handleSetLink} disabled={!hasTracker}>
          Link
        </button>
        <button type="button" onClick={() => editor?.chain().focus().unsetLink().run()} disabled={!hasTracker}>
          Unlink
        </button>
        <button type="button" onClick={() => editor?.chain().focus().undo().run()} disabled={!hasTracker}>
          Undo
        </button>
        <button type="button" onClick={() => editor?.chain().focus().redo().run()} disabled={!hasTracker}>
          Redo
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          onClick={() =>
            editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          disabled={!hasTracker}
        >
          Table
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addRowAfter().run()}
          disabled={!hasTracker}
        >
          + Row
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().addColumnAfter().run()}
          disabled={!hasTracker}
        >
          + Col
        </button>
        <input
          type="color"
          aria-label="Cell color"
          onChange={(event) =>
            editor?.chain().focus().setCellAttribute('backgroundColor', event.target.value).run()
          }
          disabled={!hasTracker}
        />
        <button
          type="button"
          onClick={() => editor?.chain().focus().deleteTable().run()}
          disabled={!hasTracker}
        >
          Delete table
        </button>

        <div className="toolbar-divider" />

        <button type="button" onClick={handlePickImage} disabled={!hasTracker}>
          Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="file-input"
        />
      </div>

      <div className="editor-shell">
        {hasTracker ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="editor-empty">
            <p>Select a tracker or create a new one to start writing.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export default EditorPanel
