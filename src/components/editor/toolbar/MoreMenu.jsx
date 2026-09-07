import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'

function MoreMenu({
  anchorRef,
  menuRef,
  onClose,
  onCopyLink,
  copyLinkDisabled,
  onSetDailySourcePage,
  dailySourceLabel,
  dailySourceDisabled,
  inTable,
  contextMenuItems,
}) {
  const [floatingStyle, setFloatingStyle] = useState({
    position: 'fixed',
    left: 0,
    top: 0,
    right: 'auto',
    bottom: 'auto',
    visibility: 'hidden',
  })

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return undefined

    const boundary = anchor.closest('.toolbar') ?? anchor.closest('.editor-panel') ?? undefined
    let active = true

    const updatePosition = async () => {
      const { x, y } = await computePosition(anchor, menu, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(4),
          flip({ boundary, padding: 8 }),
          shift({ boundary, padding: 8 }),
        ],
      })

      if (active) {
        setFloatingStyle({
          position: 'fixed',
          left: x,
          top: y,
          right: 'auto',
          bottom: 'auto',
          visibility: 'visible',
        })
      }
    }

    const stopAutoUpdate = autoUpdate(anchor, menu, updatePosition)
    return () => {
      active = false
      stopAutoUpdate()
    }
  }, [anchorRef, menuRef])

  return createPortal(
    <>
      <div className="more-menu-backdrop" onClick={onClose} />
      <div ref={menuRef} className="more-menu" style={floatingStyle}>
        <button
          type="button"
          className="table-context-item"
          onClick={onCopyLink}
          disabled={copyLinkDisabled}
        >
          Copy link to paragraph
        </button>
        <button
          type="button"
          className="table-context-item"
          onClick={onSetDailySourcePage}
          disabled={dailySourceDisabled}
        >
          {dailySourceLabel}
        </button>
        {inTable && contextMenuItems?.length > 0 && (
          <>
            <div className="more-menu-divider" />
            {contextMenuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="table-context-item"
                onClick={() => { item.action(); onClose() }}
              >
                {item.label}
              </button>
            ))}
          </>
        )}
      </div>
    </>,
    document.body,
  )
}

export default MoreMenu
