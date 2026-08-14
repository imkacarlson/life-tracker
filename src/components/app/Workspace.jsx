import EditorPanel from '../EditorPanel'
import SettingsHub from '../SettingsHub'
import ConflictModal from './ConflictModal'
import CopyMoveModal from './CopyMoveModal'
import NavigationTree from './NavigationTree'
import SlimHeader from './SlimHeader'
import TreeContextMenu from './TreeContextMenu'

export default function Workspace({
  interactionHandlers,
  headerProps,
  workspaceRef,
  layout,
  navigationTreeProps,
  settings,
  editorKey,
  templateEditorProps,
  primaryEditorProps,
  treeContextMenuProps,
  copyMoveModalProps,
  conflictModalProps,
}) {
  return (
    <div
      className="app"
      onPointerDownCapture={interactionHandlers.onPointerDownCapture}
      onPointerUpCapture={interactionHandlers.onPointerUpCapture}
      onPointerCancelCapture={interactionHandlers.onPointerCancelCapture}
      onKeyDownCapture={interactionHandlers.onKeyDownCapture}
    >
      <SlimHeader {...headerProps} />
      {layout.isMobileViewport && layout.isSidebarOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation drawer"
          onPointerDown={(event) => event.preventDefault()}
          onClick={layout.closeMobileSidebar}
        />
      ) : null}

      <div
        ref={workspaceRef}
        className={layout.workspaceClassName}
        style={layout.workspaceStyle}
      >
        <NavigationTree {...navigationTreeProps} />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Resize navigation sidebar"
          aria-orientation="vertical"
          tabIndex={layout.sidebarCollapsed || layout.isMobileViewport ? -1 : 0}
          onPointerDown={layout.onSidebarResizeStart}
          onKeyDown={layout.onSidebarResizeKeyDown}
        />
        {settings.isHub && <SettingsHub {...settings.hubProps} />}
        {settings.isTemplateEditing && (
          <EditorPanel key={editorKey} {...templateEditorProps} />
        )}
        {settings.showPrimaryEditor && (
          <EditorPanel key={editorKey} {...primaryEditorProps} />
        )}
      </div>
      <TreeContextMenu {...treeContextMenuProps} />
      <CopyMoveModal {...copyMoveModalProps} />
      <ConflictModal {...conflictModalProps} />
    </div>
  )
}
