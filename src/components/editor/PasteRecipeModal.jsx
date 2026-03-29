import { useRef, useState, useEffect, useCallback } from 'react'

let nextFileId = 0

function PasteRecipeModal({ open, loading, text, onTextChange, files, onFilesChange, onClose, onSubmit }) {
  const fileInputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  // Track files in a ref so the cleanup function always sees the latest value
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    }
  }, [])

  const addFiles = useCallback(
    (incoming) => {
      const imageFiles = incoming.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const remaining = 5 - files.length
      if (remaining <= 0) return

      const toAdd = imageFiles.slice(0, remaining).map((file) => ({
        id: `file-${Date.now()}-${++nextFileId}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'ready',
        error: null,
      }))
      onFilesChange([...files, ...toAdd])
    },
    [files, onFilesChange],
  )

  const removeFile = useCallback(
    (id) => {
      const target = files.find((f) => f.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      onFilesChange(files.filter((f) => f.id !== id))
    },
    [files, onFilesChange],
  )

  const handlePaste = useCallback(
    (e) => {
      // Check clipboardData.items first (broader support), then .files
      const items = e.clipboardData?.items
      const imageFiles = []
      if (items) {
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) imageFiles.push(file)
          }
        }
      }
      if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
        for (const file of e.clipboardData.files) {
          if (file.type.startsWith('image/')) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        addFiles(imageFiles)
        // Only prevent default if there's no text being pasted alongside
        if (!e.clipboardData?.getData('text/plain')) {
          e.preventDefault()
        }
      }
    },
    [addFiles],
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragActive(false)
      const dropped = Array.from(e.dataTransfer.files)
      addFiles(dropped)
    },
    [addFiles],
  )

  if (!open) return null

  const atLimit = files.length >= 5
  const canSubmit = !loading && (text.trim() || files.length > 0)

  return (
    <div
      className="ai-insert-modal-backdrop"
      onMouseDown={() => {
        if (loading) return
        onClose()
      }}
    >
      <div
        className={`ai-insert-modal recipe-modal ${dragActive ? 'recipe-drop-active' : ''}`}
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <h3>Paste Recipe</h3>
        <p className="subtle">
          Paste recipe text or attach photos. AI will format it into a clean, consistent recipe page.
        </p>

        {/* Attach button + thumbnails above textarea */}
        <div className="recipe-attachments">
          <button
            type="button"
            className="recipe-attach-btn secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || atLimit}
          >
            Attach Photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
          />

          {atLimit && <p className="recipe-limit-msg">Maximum 5 photos</p>}

          {files.length > 0 && (
            <div className="recipe-thumb-grid">
              {files.map((f) => (
                <div key={f.id} className="recipe-thumb">
                  <img src={f.previewUrl} alt={f.file.name} />
                  {f.error && <span className="recipe-thumb-error" title={f.error}>!</span>}
                  <button
                    type="button"
                    className="recipe-thumb-remove"
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() => removeFile(f.id)}
                    disabled={loading}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <textarea
          className="ai-insert-textarea"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={handlePaste}
          placeholder="Paste your recipe here..."
          rows={10}
          disabled={loading}
        />
        <div className="ai-insert-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" onClick={onSubmit} disabled={!canSubmit}>
            {loading ? 'Formatting...' : 'Create Recipe'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PasteRecipeModal
