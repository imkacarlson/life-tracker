import { useEffect, useRef, useState } from 'react'

function GearMenu({ settingsActive = false, onOpenSettings, onSignOut }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="gear-menu-wrap">
      <button
        type="button"
        className={`ghost gear-menu-button ${settingsActive ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account and settings menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <GearIcon />
      </button>
      {open ? (
        <div className="gear-menu-panel" role="menu" aria-label="Account and settings">
          <button
            type="button"
            className="gear-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenSettings?.()
            }}
          >
            Settings
          </button>
          <button
            type="button"
            className="gear-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut?.()
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.38 3.18a1 1 0 0 1 .97-.68h1.3a1 1 0 0 1 .97.68l.36 1.17a7.69 7.69 0 0 1 1.37.57l1.1-.52a1 1 0 0 1 1.15.2l.92.92a1 1 0 0 1 .2 1.15l-.52 1.1c.22.43.41.89.57 1.37l1.17.36a1 1 0 0 1 .68.97v1.3a1 1 0 0 1-.68.97l-1.17.36a7.69 7.69 0 0 1-.57 1.37l.52 1.1a1 1 0 0 1-.2 1.15l-.92.92a1 1 0 0 1-1.15.2l-1.1-.52c-.43.22-.89.41-1.37.57l-.36 1.17a1 1 0 0 1-.97.68h-1.3a1 1 0 0 1-.97-.68l-.36-1.17a7.69 7.69 0 0 1-1.37-.57l-1.1.52a1 1 0 0 1-1.15-.2l-.92-.92a1 1 0 0 1-.2-1.15l.52-1.1a7.69 7.69 0 0 1-.57-1.37l-1.17-.36A1 1 0 0 1 2.5 12.65v-1.3a1 1 0 0 1 .68-.97l1.17-.36c.16-.48.35-.94.57-1.37l-.52-1.1a1 1 0 0 1 .2-1.15l.92-.92a1 1 0 0 1 1.15-.2l1.1.52c.43-.22.89-.41 1.37-.57l.36-1.17Z"
        fill="currentColor"
      />
      <circle cx="12" cy="12" r="3.1" fill="var(--surface)" />
    </svg>
  )
}

export default GearMenu
