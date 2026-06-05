// Render-only Tiptap extension set for server-side HTML generation.
//
// This mirrors the editor's schema in `src/hooks/useEditorSetup.js` but drops
// every interactive/ProseMirror-plugin extension (keyboard shortcuts, find,
// paste fixes, EnsureNodeIds, InternalLink click handling). For producing static
// HTML we only need the node/mark *schema* + their renderHTML — so we reuse the
// app's own custom node extensions to guarantee the markup matches the real
// editor (same `data-type`s, table colgroup, cell background colors, block ids).

import StarterKit from '@tiptap/starter-kit'
import ListItem from '@tiptap/extension-list-item'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import { TableRow } from '@tiptap/extension-table'

import {
  ParagraphWithId,
  HeadingWithId,
  BulletListWithId,
  OrderedListWithId,
  TaskListWithId,
} from '../../src/extensions/nodeExtensions.js'
import {
  TableWithId,
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '../../src/extensions/tableExtensions.js'
import { SecureImage } from '../../src/extensions/editorExtensions.js'

// Same node/mark set as the live editor, minus the interactive plugins.
export const renderExtensions = [
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    listItem: false,
    link: false,
    underline: false,
    paragraph: false,
    heading: false,
  }),
  ParagraphWithId,
  HeadingWithId,
  BulletListWithId,
  OrderedListWithId,
  ListItem,
  TaskListWithId.configure({ nested: true }),
  TaskItem.configure({ nested: true }),
  Underline,
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Link.configure({ openOnClick: false }),
  SecureImage.configure({ inline: false, allowBase64: false }),
  TableWithId.configure({ resizable: true }),
  TableRow,
  TableHeaderWithBackground,
  TableCellWithBackground,
]
