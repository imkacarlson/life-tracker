import { create } from 'zustand'
import { isTouchOnlyDevice } from '../utils/device'
import { readStoredColor, saveStoredColor } from '../utils/storage'
import {
  HIGHLIGHT_COLOR_KEY,
  SHADING_COLOR_KEY,
  TEXT_COLOR_KEY,
} from '../utils/constants'

export const useEditorUIStore = create((set, get) => ({
  // Toolbar layout
  toolbarExpanded: !isTouchOnlyDevice(),
  setToolbarExpanded: (v) => set((state) => ({
    toolbarExpanded: typeof v === 'function' ? v(state.toolbarExpanded) : v,
  })),

  // Find bar
  findOpen: false,
  findQuery: '',
  findStatus: { query: '', matches: [], index: -1 },
  setFindOpen: (v) => set({ findOpen: v }),
  setFindQuery: (q) => set({ findQuery: q }),
  setFindStatus: (s) => set({ findStatus: s }),

  // AI Find — semantic mode layered over the literal find bar. Defaults on and
  // persists for the session so the user isn't re-opting-out each time.
  aiSearchMode: true,
  aiSearchLoading: false,
  setAiSearchMode: (v) => set({ aiSearchMode: v }),
  setAiSearchLoading: (v) => set({ aiSearchLoading: v }),

  // AI Insert modal
  aiInsertOpen: false,
  aiInsertLoading: false,
  aiInsertText: '',
  setAiInsertOpen: (v) => set({ aiInsertOpen: v }),
  setAiInsertLoading: (v) => set({ aiInsertLoading: v }),
  setAiInsertText: (v) => set({ aiInsertText: v }),

  // AI Daily
  aiLoading: false,
  aiDailyDate: new Date(),
  setAiLoading: (v) => set({ aiLoading: v }),
  setAiDailyDate: (d) => set((state) => ({
    aiDailyDate: typeof d === 'function' ? d(state.aiDailyDate) : d,
  })),

  // Selection context (synced from editor selection)
  inTable: false,
  isInList: false,
  currentBlockId: null,
  setInTable: (v) => set({ inTable: v }),
  setIsInList: (v) => set({ isInList: v }),
  setCurrentBlockId: (id) => set({ currentBlockId: id }),

  // Colors (synced from editor selection, persisted across sessions).
  // Each setter guards on change before persisting so the selection-sync
  // effects (which fire on every cursor move) don't churn localStorage.
  highlightColor: readStoredColor(HIGHLIGHT_COLOR_KEY, '#fef08a'),
  textColor: readStoredColor(TEXT_COLOR_KEY, null),
  shadingColor: readStoredColor(SHADING_COLOR_KEY, null),
  setHighlightColor: (c) => {
    if (c === get().highlightColor) return
    set({ highlightColor: c })
    saveStoredColor(HIGHLIGHT_COLOR_KEY, c)
  },
  setTextColor: (c) => {
    if (c === get().textColor) return
    set({ textColor: c })
    saveStoredColor(TEXT_COLOR_KEY, c)
  },
  setShadingColor: (c) => {
    if (c === get().shadingColor) return
    set({ shadingColor: c })
    saveStoredColor(SHADING_COLOR_KEY, c)
  },

  // Context menu
  // `misspelling` is { word, from, to } when the right-click landed on a
  // flagged word, else null.
  contextMenu: { open: false, x: 0, y: 0, blockId: null, inTable: false, misspelling: null },
  submenuOpen: false,
  submenuDirection: 'right',
  setContextMenu: (m) => set({ contextMenu: m }),
  setSubmenuOpen: (v) => set({ submenuOpen: v }),
  setSubmenuDirection: (d) => set({ submenuDirection: d }),

  // Copy button flash label
  copyLabel: 'Copy',
  setCopyLabel: (v) => set({ copyLabel: v }),

  // Reset on page/tracker change
  resetOnTrackerChange: () => set({
    findOpen: false,
    findQuery: '',
    findStatus: { query: '', matches: [], index: -1 },
    aiSearchLoading: false,
    aiInsertOpen: false,
    aiInsertText: '',
    contextMenu: { open: false, x: 0, y: 0, blockId: null, inTable: false, misspelling: null },
    submenuOpen: false,
  }),
}))
