import { create } from 'zustand';

export interface Notice {
  id: string;
  tone: 'info' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface UiState {
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

let noticeSeq = 0;

export const useUiStore = create<UiState>()((set) => ({
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
