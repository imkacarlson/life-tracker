// Thin compatibility re-export. Highlight still uses the word-level toggle
// helper in ./smartMark, while the regular inline toolbar tools use the
// block-level sibling. Kept as an alias so existing imports and tests keep
// working.

export { isMarkActiveForToggle as isHighlightActiveForToggle } from './smartMark'
