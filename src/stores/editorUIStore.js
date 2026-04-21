import { create } from 'zustand'
import { isTouchOnlyDevice } from '../utils/device'

export const useEditorUIStore = create((set) => ({
  // Toolbar layout
  toolbarExpanded: !isTouchOnlyDevice(),
  setToolbarExpanded: (v) => set({ toolbarExpanded: v }),

  // Find bar
  findOpen: false,
  findQuery: '',
  findStatus: { query: '', matches: [], index: -1 },
  setFindOpen: (v) => set({ findOpen: v }),
  setFindQuery: (q) => set({ findQuery: q }),
  setFindStatus: (s) => set({ findStatus: s }),

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
  setAiDailyDate: (d) => set({ aiDailyDate: d }),

  // Selection context (synced from editor selection)
  inTable: false,
  isInList: false,
  currentBlockId: null,
  setInTable: (v) => set({ inTable: v }),
  setIsInList: (v) => set({ isInList: v }),
  setCurrentBlockId: (id) => set({ currentBlockId: id }),

  // Colors (synced from editor selection)
  highlightColor: '#fef08a',
  shadingColor: null,
  setHighlightColor: (c) => set({ highlightColor: c }),
  setShadingColor: (c) => set({ shadingColor: c }),

  // Context menu
  contextMenu: { open: false, x: 0, y: 0, blockId: null, inTable: false },
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
    aiInsertOpen: false,
    aiInsertText: '',
    contextMenu: { open: false, x: 0, y: 0, blockId: null, inTable: false },
    submenuOpen: false,
  }),
}))
