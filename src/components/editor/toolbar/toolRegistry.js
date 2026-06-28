// Toolbar tool registry. Imports the tool components from the themed `tools/*`
// files and maps them to stable ids, then defines the core/extra group layout.
// This module exports only config objects (no components), so it never trips
// react-refresh/only-export-components.

import {
  BoldTool, ItalicTool, UnderlineTool, StrikeTool,
  H1Tool, H2Tool, HighlightTool, TextColorTool,
} from './tools/textTools'
import {
  BulletListTool, OrderedListTool, TaskListTool, OutdentTool, IndentTool,
} from './tools/listTools'
import { AlignLeftTool, AlignCenterTool, AlignRightTool } from './tools/alignTools'
import {
  LinkTool, UnlinkTool, ImageTool, TableTool,
  AddRowTool, AddColTool, ShadingTool, DeleteTableTool,
} from './tools/insertTools'
import { UndoTool, RedoTool, ExportTool, CopyTool } from './tools/historyTools'
import { AiDailyTool, AiInsertTool } from './tools/aiTools'
import { FindTool, MoreTool } from './tools/utilityTools'

// --- Registry -------------------------------------------------------------

export const TOOL_DEFINITIONS = {
  bold:        { Component: BoldTool },
  italic:      { Component: ItalicTool },
  underline:   { Component: UnderlineTool },
  strike:      { Component: StrikeTool },
  h1:          { Component: H1Tool },
  h2:          { Component: H2Tool },
  bulletList:  { Component: BulletListTool },
  orderedList: { Component: OrderedListTool },
  taskList:    { Component: TaskListTool },
  outdent:     { Component: OutdentTool, mobileOnly: true },
  indent:      { Component: IndentTool, mobileOnly: true },
  link:        { Component: LinkTool },
  unlink:      { Component: UnlinkTool },
  highlight:   { Component: HighlightTool },
  textColor:   { Component: TextColorTool },
  alignLeft:   { Component: AlignLeftTool },
  alignCenter: { Component: AlignCenterTool },
  alignRight:  { Component: AlignRightTool },
  image:       { Component: ImageTool },
  table:       { Component: TableTool },
  addRow:      { Component: AddRowTool },
  addCol:      { Component: AddColTool },
  shading:     { Component: ShadingTool },
  deleteTable: { Component: DeleteTableTool },
  undo:        { Component: UndoTool },
  redo:        { Component: RedoTool },
  export:      { Component: ExportTool },
  copy:        { Component: CopyTool },
  aiDaily:     { Component: AiDailyTool },
  aiInsert:    { Component: AiInsertTool },
  find:        { Component: FindTool },
  more:        { Component: MoreTool },
}

/**
 * Groups rendered inside `.toolbar-core` (always visible, even on mobile
 * collapsed state). Mobile-only tools (indent/outdent) are filtered out on
 * desktop by the renderer.
 */
export const CORE_GROUPS = [
  { id: 'core-inline', tools: ['bold', 'italic', 'strike', 'h1', 'highlight', 'bulletList', 'outdent', 'indent'] },
  { id: 'core-find-undo', tools: ['find', 'undo'] },
]

/**
 * Groups rendered inside `.toolbar-extra` (hidden on mobile when collapsed).
 * Order is verbatim from the legacy Toolbar.jsx render path.
 */
export const EXTRA_GROUPS = [
  { id: 'extra-text', tools: ['underline', 'textColor'] },
  { id: 'extra-headings', tools: ['h2', 'orderedList', 'taskList'] },
  { id: 'extra-align', tools: ['alignLeft', 'alignCenter', 'alignRight'] },
  { separator: true, id: 'sep-1' },
  { id: 'extra-insert', tools: ['link', 'unlink', 'image', 'table', 'addRow', 'addCol', 'shading', 'deleteTable'] },
  { separator: true, id: 'sep-2' },
  { id: 'extra-utility', tools: ['redo', 'export', 'copy'] },
  { id: 'extra-ai', tools: ['aiDaily', 'aiInsert'], visible: (ctx) => Boolean(ctx.showAiDaily) },
  { id: 'extra-more', tools: ['more'] },
]
