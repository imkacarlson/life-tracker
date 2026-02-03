function serializeInline(content) {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'text') {
        let text = node.text || ''
        const marks = node.marks || []
        if (marks.some((m) => m.type === 'strike')) return ''
        if (marks.some((m) => m.type === 'bold')) text = `**${text}**`
        if (marks.some((m) => m.type === 'italic')) text = `_${text}_`
        if (marks.some((m) => m.type === 'highlight')) text = `[${text}]`
        if (marks.some((m) => m.type === 'link')) {
          const href = marks.find((m) => m.type === 'link')?.attrs?.href || ''
          text = `${text} (${href})`
        }
        return text
      }
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'image') return '[image]'
      return ''
    })
    .join('')
}

function serializeNode(node, indent = 0, listIndex = null) {
  const lines = []
  const prefix = '  '.repeat(indent)
  const id = node.attrs?.id || null
  const idTag = id ? ` {{id:${id}}}` : ''
  const pushIfNotEmpty = (value) => {
    if (value !== '') lines.push(value)
  }

  switch (node.type) {
    case 'doc':
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent))
      })
      break
    case 'paragraph': {
      const text = serializeInline(node.content)
      if (text.trim().length === 0) return ''
      lines.push(prefix + text + idTag)
      break
    }
    case 'heading': {
      const text = serializeInline(node.content)
      if (text.trim().length === 0) return ''
      if (lines.length > 0) lines.push('')
      lines.push(prefix + text.toUpperCase() + idTag)
      lines.push('')
      break
    }
    case 'bulletList':
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent, 'bullet'))
      })
      break
    case 'orderedList': {
      let counter = 1
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent, counter))
        counter += 1
      })
      break
    }
    case 'taskList':
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent, 'task'))
      })
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
          const childId = child.attrs?.id ? ` {{id:${child.attrs.id}}}` : ''
          const text = serializeInline(child.content)
          if (text.trim().length === 0) return
          lines.push(prefix + marker + text + childId)
        } else {
          pushIfNotEmpty(serializeNode(child, indent + 1))
        }
      })
      break
    }
    case 'table':
      node.content?.forEach((row, rowIdx) => {
        row.content?.forEach((cell) => {
          cell.content?.forEach((child) => {
            pushIfNotEmpty(serializeNode(child, indent))
          })
        })
        if (rowIdx < (node.content?.length || 0) - 1) lines.push(prefix + '---')
      })
      break
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent))
      })
      break
    case 'blockquote':
      node.content?.forEach((child) => {
        pushIfNotEmpty(serializeNode(child, indent + 1))
      })
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
        node.content.forEach((child) => {
          pushIfNotEmpty(serializeNode(child, indent))
        })
      }
      break
  }
  return lines.join('\n')
}

export function serializeDocToText(doc) {
  return serializeNode(doc).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
}
