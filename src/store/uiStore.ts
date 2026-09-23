import { create } from 'zustand';
import type { WorkspaceTab } from '../types/media';

export interface Notice {
  id: string;
  tone: 'info' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface UiState {
  /** Tool shown in the workspace section. */
  activeTool: WorkspaceTab;
  setActiveTool: (tool: WorkspaceTab) => void;
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

const HASH_TABS: Record<string, WorkspaceTab> = { '#convert': 'convert', '#resize': 'resize', '#pdf': 'pdf' };

/** "#convert", "#resize" and "#pdf" links open those tools directly. */
export function toolFromHash(): WorkspaceTab {
  if (typeof window === 'undefined') return 'compress';
  return HASH_TABS[window.location.hash] ?? 'compress';
}

export function isToolHash(href: string): boolean {
  return href in HASH_TABS;
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
