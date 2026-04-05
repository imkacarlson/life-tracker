const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function BoldIcon() {
  return (
    <svg {...base}>
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  )
}

export function ItalicIcon() {
  return (
    <svg {...base}>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  )
}

export function UnderlineIcon() {
  return (
    <svg {...base}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  )
}

export function StrikethroughIcon() {
  return (
    <svg {...base}>
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M17.3 4.9c-.8-1.2-2.5-1.9-4.3-1.9-2.8 0-5 1.6-5 4 0 1 .4 1.8 1 2.5" />
      <path d="M8 16c.8 1.2 2.5 2 4.3 2 2.8 0 5-1.3 5-3.5 0-.7-.2-1.3-.5-1.8" />
    </svg>
  )
}

export function HighlightIcon() {
  return (
    <svg {...base}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

export function TextColorIcon() {
  return (
    <svg {...base}>
      <path d="M4 20h16" />
      <path d="M9.5 4h5L19 16h-3l-1-3H9l-1 3H5L9.5 4z" />
    </svg>
  )
}

export function BulletListIcon() {
  return (
    <svg {...base}>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function OrderedListIcon() {
  return (
    <svg {...base}>
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <text x="3" y="8" style={{ fontSize: '7px', fill: 'currentColor', stroke: 'none', fontWeight: 600 }}>1</text>
      <text x="3" y="14" style={{ fontSize: '7px', fill: 'currentColor', stroke: 'none', fontWeight: 600 }}>2</text>
      <text x="3" y="20" style={{ fontSize: '7px', fill: 'currentColor', stroke: 'none', fontWeight: 600 }}>3</text>
    </svg>
  )
}

export function TaskListIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <path d="M5.5 6.5l1.5 1.5 3-3" strokeWidth="1.5" />
      <line x1="14" y1="6" x2="21" y2="6" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <line x1="14" y1="17.5" x2="21" y2="17.5" />
    </svg>
  )
}

export function AlignLeftIcon() {
  return (
    <svg {...base}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  )
}

export function AlignCenterIcon() {
  return (
    <svg {...base}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}

export function AlignRightIcon() {
  return (
    <svg {...base}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg {...base}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function UnlinkIcon() {
  return (
    <svg {...base}>
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

export function TableIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}

export function AddRowIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="15" x2="12" y2="21" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </svg>
  )
}

export function AddColIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="15" y1="12" x2="21" y2="12" />
      <line x1="18" y1="9" x2="18" y2="15" />
    </svg>
  )
}

export function DeleteTableIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

export function UndoIcon() {
  return (
    <svg {...base}>
      <path d="M3 10h13a4 4 0 0 1 0 8H7" />
      <polyline points="7 6 3 10 7 14" />
    </svg>
  )
}

export function RedoIcon() {
  return (
    <svg {...base}>
      <path d="M21 10H8a4 4 0 0 0 0 8h9" />
      <polyline points="17 6 21 10 17 14" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function ExportIcon() {
  return (
    <svg {...base}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function AiIcon() {
  return (
    <svg {...base} width={13} height={13}>
      <path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1l-3 4-3-4H8a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z" />
    </svg>
  )
}

export function IndentIcon() {
  return (
    <svg {...base}>
      <polyline points="3 8 7 12 3 16" />
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="12" x2="10" y2="12" />
      <line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  )
}

export function OutdentIcon() {
  return (
    <svg {...base}>
      <polyline points="7 8 3 12 7 16" />
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="12" x2="10" y2="12" />
      <line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  )
}

export function ShadingIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" opacity="0.3" stroke="none" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
