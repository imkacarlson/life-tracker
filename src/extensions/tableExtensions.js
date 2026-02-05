import { Table, TableCell, TableHeader, TableView, createColGroup } from '@tiptap/extension-table'
import { mergeAttributes } from '@tiptap/core'

const withIdAttribute = (parentAttributes = {}) => ({
  ...parentAttributes,
  id: {
    default: null,
    parseHTML: (element) => element.getAttribute('id'),
    renderHTML: (attributes) => {
      if (!attributes.id) return {}
      return { id: attributes.id }
    },
  },
  created_at: {
    default: null,
    parseHTML: (element) => element.getAttribute('data-created-at'),
    renderHTML: (attributes) => {
      if (!attributes.created_at) return {}
      return { 'data-created-at': attributes.created_at }
    },
  },
})

const applyBackgroundStyle = (HTMLAttributes, backgroundColor) => {
  if (!backgroundColor) return HTMLAttributes
  const existing = HTMLAttributes?.style ?? ''
  const suffix = existing && !existing.trim().endsWith(';') ? ';' : ''
  const style = `${existing}${suffix}background-color: ${backgroundColor};`
  return { ...HTMLAttributes, style }
}

class TableViewWithId extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth)
    this.updateId(node)
  }

  update(node) {
    const result = super.update(node)
    if (result) {
      this.updateId(node)
    }
    return result
  }

  updateId(node) {
    const id = node?.attrs?.id
    if (id) {
      this.table.id = id
      return
    }
    this.table.removeAttribute('id')
  }
}

export const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style?.backgroundColor || null,
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = applyBackgroundStyle(HTMLAttributes, node.attrs?.backgroundColor)
    return ['td', mergeAttributes(this.options.HTMLAttributes, attrs), 0]
  },
})

export const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style?.backgroundColor || null,
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = applyBackgroundStyle(HTMLAttributes, node.attrs?.backgroundColor)
    return ['th', mergeAttributes(this.options.HTMLAttributes, attrs), 0]
  },
})

export const TableWithId = Table.extend({
  addOptions() {
    const parent = this.parent?.()
    return {
      ...(parent ?? {}),
      View: TableViewWithId,
    }
  },
  addAttributes() {
    return withIdAttribute(this.parent?.())
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(
      node,
      this.options.cellMinWidth,
    )
    const userStyles = HTMLAttributes.style
    const style = userStyles || (tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`)
    const table = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style,
        id: HTMLAttributes.id || null,
      }),
      colgroup,
      ['tbody', 0],
    ]
    return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table
  },
})
