/**
 * Returns a sorted copy of the pages cached for a given section.
 * Pages with a null/undefined sort_order sort to the end.
 *
 * @param {Record<string, Array>} pagesBySection - keyed by section ID
 * @param {string} sectionId
 * @returns {Array}
 */
export function getSectionPages(pagesBySection, sectionId) {
  const pages = pagesBySection[sectionId]
  if (!pages || pages.length === 0) return []
  return [...pages].sort((a, b) => {
    const aOrder = a.sort_order ?? Infinity
    const bOrder = b.sort_order ?? Infinity
    return aOrder - bOrder
  })
}
