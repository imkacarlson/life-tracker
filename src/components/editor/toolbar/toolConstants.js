// Color palettes used by the toolbar pickers. Kept separate from the tool
// components so this module exports only data (no React components), which lets
// Vite fast-refresh the component files cleanly.

// Highlight swatches (pale tints suitable as text background highlights).
export const HIGHLIGHT_COLORS = [
  [
    { label: 'Yellow', value: '#fef08a' },
    { label: 'Green', value: '#86efac' },
    { label: 'Cyan', value: '#67e8f9' },
    { label: 'Magenta', value: '#f0abfc' },
    { label: 'Blue', value: '#93c5fd' },
  ],
  [
    { label: 'Red', value: '#fca5a5' },
    { label: 'Dark Navy', value: '#0f172a' },
    { label: 'Teal', value: '#0d9488' },
    { label: 'Dark Green', value: '#166534' },
    { label: 'Purple', value: '#7c3aed' },
  ],
  [
    { label: 'Dark Maroon', value: '#7f1d1d' },
    { label: 'Olive', value: '#a16207' },
    { label: 'Gray', value: '#6b7280' },
    { label: 'Light Gray', value: '#d1d5db' },
    { label: 'Black', value: '#000000' },
  ],
  [
    { label: 'Light Yellow', value: '#fef9c3' },
    { label: 'Light Green', value: '#dcfce7' },
    { label: 'Light Cyan', value: '#cffafe' },
    { label: 'Pink', value: '#fbcfe8' },
    { label: 'Light Blue', value: '#dbeafe' },
  ],
  [
    { label: 'Orange', value: '#fdba74' },
    { label: 'Medium Light Green', value: '#bbf7d0' },
    { label: 'Medium Cyan', value: '#99f6e4' },
    { label: 'Lavender', value: '#e9d5ff' },
    { label: 'Bright Cyan', value: '#22d3ee' },
  ],
  [
    { label: 'Light Orange', value: '#fed7aa' },
    { label: 'Pale Green', value: '#ecfccb' },
    { label: 'Pale Teal', value: '#ccfbf1' },
    { label: 'Pale Lavender', value: '#f3e8ff' },
    { label: 'Pale Blue', value: '#e0f2fe' },
  ],
]

// Text-appropriate colors (readable as letterforms, not pale highlight tints).
export const TEXT_COLORS = [
  [
    { label: 'Black', value: '#000000' },
    { label: 'Dark Gray', value: '#374151' },
    { label: 'Gray', value: '#6b7280' },
    { label: 'Red', value: '#dc2626' },
    { label: 'Orange', value: '#ea580c' },
  ],
  [
    { label: 'Amber', value: '#b45309' },
    { label: 'Green', value: '#16a34a' },
    { label: 'Teal', value: '#0d9488' },
    { label: 'Blue', value: '#2563eb' },
    { label: 'Navy', value: '#1e3a8a' },
  ],
  [
    { label: 'Indigo', value: '#4f46e5' },
    { label: 'Purple', value: '#7c3aed' },
    { label: 'Magenta', value: '#c026d3' },
    { label: 'Pink', value: '#db2777' },
    { label: 'Maroon', value: '#7f1d1d' },
  ],
]

// Cell-shading palettes. Theme palette mirrors the original derived swatches
// (10 base x 5 brightness); buildThemeRows() in toolHelpers expands these.
export const THEME_BASE_COLORS = [
  '#ffffff', '#000000', '#1f2937', '#1e3a8a', '#2563eb',
  '#ef4444', '#7f1d1d', '#f97316', '#f59e0b', '#16a34a',
]
export const STANDARD_SHADING_COLORS = [
  '#7f1d1d', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#0f766e', '#3b82f6', '#1e3a8a', '#0f172a', '#7c3aed',
]
