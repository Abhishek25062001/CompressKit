import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PageRotation, PdfPage, PdfSettings, PdfSource } from '../types/pdf';

interface PdfState {
  sources: Record<string, PdfSource>;
  pages: PdfPage[];
  /** Label of the action running now, such as "Building PDF", or null when idle. */
  busy: string | null;
  /** 0..1 while an action can measure its progress. */
  progress: number | null;
  addSource: (source: PdfSource, pages: PdfPage[]) => void;
  updatePage: (id: string, patch: Partial<PdfPage>) => void;
  movePage: (id: string, toIndex: number) => void;
  rotatePage: (id: string, delta: 90 | -90) => void;
  removePage: (id: string) => void;
  toggleSelected: (id: string) => void;
  setSelection: (ids: Set<string>) => void;
  clear: () => void;
  setBusy: (busy: string | null, progress?: number | null) => void;
}

/** Sources whose last page was removed; the PDF tool releases their parsed documents. */
type ReleaseListener = (sourceIds: string[]) => void;
let onRelease: ReleaseListener = () => undefined;
export function setPdfReleaseListener(listener: ReleaseListener): void {
  onRelease = listener;
}

export const usePdfStore = create<PdfState>()((set, get) => ({
  sources: {},
  pages: [],
  busy: null,
  progress: null,
  addSource: (source, pages) =>
    set((s) => ({ sources: { ...s.sources, [source.id]: source }, pages: [...s.pages, ...pages] })),
  updatePage: (id, patch) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  movePage: (id, toIndex) =>
    set((s) => {
      const from = s.pages.findIndex((p) => p.id === id);
      if (from < 0) return s;
      const pages = [...s.pages];
      const [page] = pages.splice(from, 1);
      pages.splice(Math.max(0, Math.min(pages.length, toIndex)), 0, page);
      return { pages };
    }),
  rotatePage: (id, delta) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 as PageRotation } : p)),
    })),
  removePage: (id) => {
    const page = get().pages.find((p) => p.id === id);
    if (!page) return;
    if (page.thumbUrl) URL.revokeObjectURL(page.thumbUrl);
    const pages = get().pages.filter((p) => p.id !== id);
    const orphaned = pages.some((p) => p.sourceId === page.sourceId) ? [] : [page.sourceId];
    const sources = { ...get().sources };
    orphaned.forEach((sid) => delete sources[sid]);
    set({ pages, sources });
    if (orphaned.length) onRelease(orphaned);
  },
  toggleSelected: (id) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)) })),
  setSelection: (ids) => set((s) => ({ pages: s.pages.map((p) => ({ ...p, selected: ids.has(p.id) })) })),
  clear: () => {
    const { pages, sources } = get();
    pages.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
    set({ pages: [], sources: {}, busy: null, progress: null });
    onRelease(Object.keys(sources));
  },
  setBusy: (busy, progress = null) => set({ busy, progress }),
}));

export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  pageSize: 'a4',
  orientation: 'auto',
  margin: 'small',
  photoQuality: 'standard',
  splitEvery: 1,
  imageFormat: 'jpeg',
  imageDpi: 150,
};

interface PdfSettingsState extends PdfSettings {
  update: (patch: Partial<PdfSettings>) => void;
}

export const usePdfSettingsStore = create<PdfSettingsState>()(
  persist(
    (set) => ({ ...DEFAULT_PDF_SETTINGS, update: (patch) => set(patch) }),
    {
      name: 'compresskit-pdf-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        pageSize: s.pageSize,
        orientation: s.orientation,
        margin: s.margin,
        photoQuality: s.photoQuality,
        splitEvery: s.splitEvery,
        imageFormat: s.imageFormat,
        imageDpi: s.imageDpi,
      }),
    },
  ),
);
