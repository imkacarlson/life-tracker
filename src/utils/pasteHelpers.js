export const summarizeSlice = (slice) => {
  const lines = []
  const walk = (node, listDepth = 0) => {
    const name = node.type?.name
    let nextDepth = listDepth
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      nextDepth = listDepth + 1
    }
    if (name === 'paragraph' || name === 'heading') {
      // Collect highlight mark spans from inline content so paste reconciliation
      // can re-apply only the clipboard's marks (prevents bleed to the whole line).
      const highlights = []
      let offset = 0
      node.content?.forEach((child) => {
        const childLen = child.nodeSize
        if (child.type?.name === 'text') {
          const highlightMark = child.marks?.find((m) => m.type?.name === 'highlight')
          if (highlightMark) {
            highlights.push({ from: offset, to: offset + childLen, color: highlightMark.attrs?.color ?? null })
          }
        }
        offset += childLen
      })
      lines.push({
        type: name,
        align: node.attrs?.textAlign ?? 'left',
        listDepth,
        text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        highlights,
      })
    }
    node.content?.forEach((child) => walk(child, nextDepth))
  }
  walk(slice.content)
  return lines
}
