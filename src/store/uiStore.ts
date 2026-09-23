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
  /** File whose crop editor is open (resize tool). */
  croppingFileId: string | null;
  openCrop: (id: string) => void;
  closeCrop: () => void;
  /** File whose individual settings dialog is open. */
  editingFileId: string | null;
  notices: Notice[];
  openFileSettings: (id: string) => void;
  closeFileSettings: () => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
}

/** "#convert" and "#resize" links open those tools directly. */
export function toolFromHash(): ToolMode {
  if (typeof window === 'undefined') return 'compress';
  const hash = window.location.hash;
  return hash === '#convert' ? 'convert' : hash === '#resize' ? 'resize' : 'compress';
}

let noticeSeq = 0;

export const useUiStore = create<UiState>()((set) => ({
  activeTool: toolFromHash(),
  setActiveTool: (activeTool) => set({ activeTool }),
  croppingFileId: null,
  openCrop: (id) => set({ croppingFileId: id }),
  closeCrop: () => set({ croppingFileId: null }),
  editingFileId: null,
  notices: [],
  openFileSettings: (id) => set({ editingFileId: id }),
  closeFileSettings: () => set({ editingFileId: null }),
  pushNotice: (notice) =>
    set((s) => ({ notices: [...s.notices.slice(-3), { ...notice, id: `n${++noticeSeq}` }] })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
