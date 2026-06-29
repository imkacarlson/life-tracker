// Thin compatibility re-export. The highlight toggle decision was generalized
// into the mark-agnostic isMarkActiveForToggle in ./smartMark, so Bold, Italic,
// Underline, Text color, and Highlight share one implementation. Kept as an
// alias so existing imports (and highlightState.test.js) keep working.

export { isMarkActiveForToggle as isHighlightActiveForToggle } from './smartMark'
