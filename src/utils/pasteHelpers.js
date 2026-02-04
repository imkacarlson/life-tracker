export const summarizeSlice = (slice) => {
  const lines = []
  const walk = (node, listDepth = 0) => {
    const name = node.type?.name
    let nextDepth = listDepth
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      nextDepth = listDepth + 1
    }
    if (name === 'paragraph' || name === 'heading') {
      lines.push({
        type: name,
        align: node.attrs?.textAlign ?? 'left',
        listDepth,
        text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      })
    }
    node.content?.forEach((child) => walk(child, nextDepth))
  }
  walk(slice.content)
  return lines
}
