import { useMemo, useRef, useState } from 'react'
import { SearchIcon, MoreIcon } from '../../ToolbarIcons'
import { useEditorUIStore } from '../../../../stores/editorUIStore'
import MoreMenu from '../MoreMenu'
import { useToolbarContext } from '../ToolbarContext'
import { useOutsideClick } from '../useOutsideClick'
import { Btn } from './ToolButton'

// --- Find -----------------------------------------------------------------

export function FindTool() {
  const { openFind } = useToolbarContext()
  return (
    <Btn
      onActivate={openFind}
      title="Find"
      ariaLabel="Find in page"
    >
      <SearchIcon />
    </Btn>
  )
}

// --- More menu ------------------------------------------------------------

export function MoreTool() {
  const ctx = useToolbarContext()
  const {
    hasEditorTarget,
    toolbarDeepLinkHash,
    isCurrentDailySourcePage,
    dailySourceSaving,
    onSetDailySourcePage,
    handleSetDailySourceFromToolbar,
    contextMenuItems,
  } = ctx
  const inTable = useEditorUIStore((s) => s.inTable)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const refs = useMemo(() => [wrapRef, menuRef], [])
  useOutsideClick({ isOpen: open, onClose: () => setOpen(false), refs })

  const onCopyLink = async () => {
    if (toolbarDeepLinkHash) await navigator.clipboard.writeText(toolbarDeepLinkHash)
    setOpen(false)
  }

  const onSetDailySource = async () => {
    await handleSetDailySourceFromToolbar()
    setOpen(false)
  }

  return (
    <div className="more-menu-wrap" ref={wrapRef}>
      <Btn
        onActivate={() => setOpen((prev) => !prev)}
        title="More"
        ariaLabel="More actions"
      >
        <MoreIcon />
      </Btn>
      {open && (
        <MoreMenu
          anchorRef={wrapRef}
          menuRef={menuRef}
          onClose={() => setOpen(false)}
          onCopyLink={onCopyLink}
          copyLinkDisabled={!toolbarDeepLinkHash}
          onSetDailySourcePage={onSetDailySource}
          dailySourceLabel={
            isCurrentDailySourcePage
              ? 'This page is the tracker page'
              : dailySourceSaving
              ? 'Setting tracker page...'
              : 'Set this page as tracker'
          }
          dailySourceDisabled={
            !hasEditorTarget || isCurrentDailySourcePage || dailySourceSaving || !onSetDailySourcePage
          }
          inTable={inTable}
          contextMenuItems={contextMenuItems}
        />
      )}
    </div>
  )
}
