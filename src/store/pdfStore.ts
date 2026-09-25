import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { FieldValue } from '../features/pdf/forms';
import type { PageRotation, PdfPage, PdfSettings, PdfSource, SignatureAsset, SignaturePlacement } from '../types/pdf';
import type { DocModel } from '../features/docs/model';
import { createId } from '../utils/id';

interface PdfState {
  sources: Record<string, PdfSource>;
  pages: PdfPage[];
  /** Label of the action running now, such as "Building PDF", or null when idle. */
  busy: string | null;
  /** 0..1 while an action can measure its progress. */
  progress: number | null;
  /** Kept in memory only: a signature is never written to storage. */
  signature: SignatureAsset | null;
  /** Logo for the watermark, also in memory only. */
  watermarkLogo: SignatureAsset | null;
  setWatermarkLogo: (logo: SignatureAsset | null) => void;
  /** Page whose signature placement dialog is open. */
  signingPageId: string | null;
  /** Page whose Edit PDF dialog is open. */
  editingPageId: string | null;
  setEditingPage: (id: string | null) => void;
  /** Pictures placed with Edit PDF, by id. Kept in memory only. */
  editImages: Record<string, SignatureAsset>;
  addEditImage: (id: string, image: SignatureAsset) => void;
  /** Word documents on the board, read into the document model, for merging into one Word file. */
  wordDocs: Record<string, DocModel>;
  /** Photo page whose scan cleanup dialog is open. */
  scanningPageId: string | null;
  setScanningPage: (id: string | null) => void;
  /** Answers typed into PDF forms, per source and field name. Kept in memory only. */
  formValues: Record<string, Record<string, FieldValue>>;
  setFormValue: (sourceId: string, field: string, value: FieldValue) => void;
  clearFormValues: (sourceId: string) => void;
  /** Title and author written into saved PDFs; empty leaves them out. */
  docInfo: { title: string; author: string };
  setDocInfo: (info: Partial<{ title: string; author: string }>) => void;
  /** A locked PDF waiting for its password; see features/pdf/passwordPrompt. */
  passwordPrompt: { fileName: string; wrong: boolean } | null;
  setPasswordPrompt: (prompt: { fileName: string; wrong: boolean } | null) => void;
  setSignature: (signature: SignatureAsset | null) => void;
  setSigningPage: (id: string | null) => void;
  /** Puts copies of `placements` on each page in `pageIds`, replacing what those pages had. */
  applySignatures: (pageIds: string[], placements: SignaturePlacement[]) => void;
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
  signature: null,
  signingPageId: null,
  editingPageId: null,
  setEditingPage: (editingPageId) => set({ editingPageId }),
  editImages: {},
  addEditImage: (id, image) => set((s) => ({ editImages: { ...s.editImages, [id]: image } })),
  wordDocs: {},
  scanningPageId: null,
  setScanningPage: (scanningPageId) => set({ scanningPageId }),
  passwordPrompt: null,
  formValues: {},
  setFormValue: (sourceId, field, value) =>
    set((s) => ({ formValues: { ...s.formValues, [sourceId]: { ...s.formValues[sourceId], [field]: value } } })),
  clearFormValues: (sourceId) =>
    set((s) => {
      const formValues = { ...s.formValues };
      delete formValues[sourceId];
      return { formValues };
    }),
  docInfo: { title: '', author: '' },
  setDocInfo: (info) => set((s) => ({ docInfo: { ...s.docInfo, ...info } })),
  watermarkLogo: null,
  setWatermarkLogo: (watermarkLogo) => {
    const previous = get().watermarkLogo;
    if (previous && previous !== watermarkLogo) URL.revokeObjectURL(previous.url);
    set({ watermarkLogo });
  },
  setPasswordPrompt: (passwordPrompt) => set({ passwordPrompt }),
  setSignature: (signature) => {
    const previous = get().signature;
    if (previous && previous !== signature) URL.revokeObjectURL(previous.url);
    // Placements are sized for the old signature's shape, so a new signature starts with none.
    set((s) => ({ signature, pages: s.pages.map((p) => (p.signatures.length ? { ...p, signatures: [] } : p)) }));
  },
  setSigningPage: (signingPageId) => set({ signingPageId }),
  applySignatures: (pageIds, placements) => {
    const ids = new Set(pageIds);
    set((s) => ({
      pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, signatures: placements.map((pl) => ({ ...pl, id: createId() })) } : p)),
    }));
  },
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
    const wordDocs = { ...get().wordDocs };
    orphaned.forEach((sid) => {
      delete sources[sid];
      delete wordDocs[sid];
    });
    set({ pages, sources, wordDocs });
    if (orphaned.length) onRelease(orphaned);
  },
  toggleSelected: (id) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)) })),
  setSelection: (ids) => set((s) => ({ pages: s.pages.map((p) => ({ ...p, selected: ids.has(p.id) })) })),
  clear: () => {
    const { pages, sources, editImages } = get();
    pages.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
    Object.values(editImages).forEach((img) => URL.revokeObjectURL(img.url));
    set({ pages: [], sources: {}, busy: null, progress: null, formValues: {}, docInfo: { title: '', author: '' }, editImages: {}, wordDocs: {} });
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
  pageNumbers: { enabled: false, position: 'bottom-center', format: 'page-n-of-total', start: 1, skipFirst: false },
  watermark: { enabled: false, text: 'CONFIDENTIAL', size: 'large', diagonal: true, opacity: 0.15 },
  compressLevel: 'medium',
  compressTargetKB: null,
  allowFlatten: false,
  removeComments: false,
  flattenCovered: false,
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
        pageNumbers: s.pageNumbers,
        watermark: s.watermark,
        compressLevel: s.compressLevel,
        compressTargetKB: s.compressTargetKB,
        allowFlatten: s.allowFlatten,
        removeComments: s.removeComments,
        flattenCovered: s.flattenCovered,
      }),
    },
  ),
);
