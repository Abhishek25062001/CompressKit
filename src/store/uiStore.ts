import { create } from 'zustand';
import type { ToolMode } from '../types/media';

export interface Notice {
  id: string;
  tone: 'info' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface UiState {
  /** Tool shown in the workspace section. */
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
  /** File whose individual settings dialog is open. */
  editingFileId: string | null;
  notices: Notice[];
  openFileSettings: (id: string) => void;
  closeFileSettings: () => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
}

let noticeSeq = 0;

export const useUiStore = create<UiState>()((set) => ({
  activeTool: typeof window !== 'undefined' && window.location.hash === '#convert' ? 'convert' : 'compress',
  setActiveTool: (activeTool) => set({ activeTool }),
  editingFileId: null,
  notices: [],
  openFileSettings: (id) => set({ editingFileId: id }),
  closeFileSettings: () => set({ editingFileId: null }),
  pushNotice: (notice) =>
    set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id: `n${++noticeSeq}` }] })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
