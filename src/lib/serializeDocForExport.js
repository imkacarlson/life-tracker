function serializeInline(content) {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'text') {
        let text = node.text || ''
        const marks = node.marks || []
        const hasBold = marks.some((m) => m.type === 'bold')
        const hasItalic = marks.some((m) => m.type === 'italic')
        const hasStrike = marks.some((m) => m.type === 'strike')
        const hasHighlight = marks.some((m) => m.type === 'highlight')
        if (hasBold) text = `**${text}**`
        if (hasItalic) text = `_${text}_`
        if (hasStrike) text = `~~${text}~~`
        if (hasHighlight) text = `[${text}]`
        return text
      }
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'image') return '[image]'
      return ''
    })
    .join('')
}

function serializeNode(node, lines, indent = 0, listIndex = null) {
  const prefix = '  '.repeat(indent)

  switch (node.type) {
    case 'doc':
      node.content?.forEach((child) => serializeNode(child, lines, indent))
      break

    case 'paragraph': {
      const text = serializeInline(node.content)
      lines.push(prefix + text)
      break
    }

    case 'heading': {
      const text = serializeInline(node.content)
      if (lines.length > 0) lines.push('')
      lines.push(prefix + text.toUpperCase())
      lines.push('')
      break
    }

    case 'bulletList':
      node.content?.forEach((child) => serializeNode(child, lines, indent, 'bullet'))
      break

    case 'orderedList': {
      let counter = 1
      node.content?.forEach((child) => {
        serializeNode(child, lines, indent, counter)
        counter += 1
      })
      break
    }

    case 'taskList':
      node.content?.forEach((child) => serializeNode(child, lines, indent, 'task'))
      break

    case 'listItem':
    case 'taskItem': {
      const marker =
        listIndex === 'bullet'
          ? '- '
          : listIndex === 'task'
            ? node.attrs?.checked
              ? '[x] '
              : '[ ] '
            : `${listIndex}. `
      const children = node.content || []
      children.forEach((child, i) => {
        if (i === 0 && child.type === 'paragraph') {
          lines.push(prefix + marker + serializeInline(child.content))
        } else {
          serializeNode(child, lines, indent + 1)
        }
      })
      break
    }

    case 'table': {
      const rows = node.content || []
      rows.forEach((row, rowIdx) => {
        const cells = (row.content || []).map((cell) => {
          const cellLines = []
          cell.content?.forEach((child) => serializeNode(child, cellLines, 0))
          return cellLines.join(' ').trim()
        })
        lines.push(prefix + '| ' + cells.join(' | ') + ' |')
        if (rowIdx === 0) {
          const separator = cells.map((c) => '-'.repeat(Math.max(c.length, 3))).join(' | ')
          lines.push(prefix + '| ' + separator + ' |')
        }
      })
      break
    }

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      node.content?.forEach((child) => serializeNode(child, lines, indent))
      break

    case 'blockquote':
      node.content?.forEach((child) => serializeNode(child, lines, indent + 1))
      break

    case 'codeBlock': {
      lines.push(prefix + '```')
      const text = node.content?.map((n) => n.text || '').join('') || ''
      text.split('\n').forEach((line) => lines.push(prefix + line))
      lines.push(prefix + '```')
      break
    }

    case 'horizontalRule':
      lines.push(prefix + '---')
      break

    default:
      if (node.content) {
        node.content.forEach((child) => serializeNode(child, lines, indent))
      }
      break
  }
}

export function serializeDocForExport(doc, title) {
  const lines = []

  if (title) {
    lines.push(title.trim().toUpperCase())
    lines.push('')
  }

  serializeNode(doc, lines)

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
