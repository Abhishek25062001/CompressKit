import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DocModel } from '../features/docs/model';
import { createId } from '../utils/id';

export type DocJobStatus = 'waiting' | 'working' | 'done' | 'failed';

/** One file in a Word ↔ PDF conversion list. */
export interface DocJob {
  id: string;
  file: File;
  status: DocJobStatus;
  progress: number;
  stage?: string;
  result?: { blob: Blob; name: string; pages?: number };
  /** Why it failed, in words for the card. */
  error?: string;
  /** Things worth knowing about a finished file, such as content that could not be carried over. */
  notes?: string[];
}

export interface DocQueueState {
  jobs: DocJob[];
  add: (files: File[]) => void;
  update: (id: string, patch: Partial<DocJob>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function createQueue(): UseBoundStore<StoreApi<DocQueueState>> {
  return create<DocQueueState>()((set) => ({
    jobs: [],
    add: (files) =>
      set((s) => ({ jobs: [...s.jobs, ...files.map((file) => ({ id: createId(), file, status: 'waiting' as const, progress: 0 }))] })),
    update: (id, patch) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
    remove: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
    clear: () => set({ jobs: [] }),
  }));
}

export const useDocxToPdfStore = createQueue();
export const usePdfToDocxStore = createQueue();

/** Every document converter, each with a list of its own. */
export type ConvertKind = 'docx-to-pdf' | 'pdf-to-docx' | 'text-to-pdf' | 'rtf-to-pdf' | 'html-to-pdf' | 'pdf-to-text' | 'pdf-to-html';

export const DOC_QUEUES: Record<ConvertKind, UseBoundStore<StoreApi<DocQueueState>>> = {
  'docx-to-pdf': useDocxToPdfStore,
  'pdf-to-docx': usePdfToDocxStore,
  'text-to-pdf': createQueue(),
  'rtf-to-pdf': createQueue(),
  'html-to-pdf': createQueue(),
  'pdf-to-text': createQueue(),
  'pdf-to-html': createQueue(),
};

export function isConvertKind(id: string): id is ConvertKind {
  return id in DOC_QUEUES;
}

export type DocPageSize = 'a4' | 'letter';

export interface TextToPdfSettings {
  font: 'mono' | 'sans' | 'serif';
  /** Points. */
  size: number;
  page: DocPageSize;
  update: (patch: Partial<Omit<TextToPdfSettings, 'update'>>) => void;
}

export const useTextToPdfSettings = create<TextToPdfSettings>()(
  persist((set) => ({ font: 'mono', size: 10, page: 'a4', update: (patch) => set(patch) }), {
    name: 'compresskit-text-to-pdf',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ font: s.font, size: s.size, page: s.page }),
  }),
);

export interface HtmlToPdfSettings {
  page: DocPageSize;
  update: (patch: Partial<Omit<HtmlToPdfSettings, 'update'>>) => void;
}

export const useHtmlToPdfSettings = create<HtmlToPdfSettings>()(
  persist((set) => ({ page: 'a4', update: (patch) => set(patch) }), {
    name: 'compresskit-html-to-pdf',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ page: s.page }),
  }),
);

export interface PdfToDocxSettings {
  /** Pull pictures out of the PDF into the document. */
  images: boolean;
  /** Read scanned pages with OCR instead of keeping them as pictures. */
  ocr: boolean;
  /** Start each PDF page on a new page in Word. */
  keepPages: boolean;
  update: (patch: Partial<Omit<PdfToDocxSettings, 'update'>>) => void;
}

export const usePdfToDocxSettings = create<PdfToDocxSettings>()(
  persist((set) => ({ images: true, ocr: true, keepPages: true, update: (patch) => set(patch) }), {
    name: 'compresskit-pdf-to-docx',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ images: s.images, ocr: s.ocr, keepPages: s.keepPages }),
  }),
);

/** The document open in the Word editor. */
interface EditorState {
  /** File name without extension, used for downloads. */
  name: string | null;
  doc: DocModel | null;
  /** Changes whenever a new document is opened, so the editor reloads its content. */
  version: number;
  loading: string | null;
  /** Parts of the file that could not be carried into the editor. */
  warnings: string[];
  set: (patch: Partial<Omit<EditorState, 'set'>>) => void;
}

export const useDocEditorStore = create<EditorState>()((set) => ({
  name: null,
  doc: null,
  version: 0,
  loading: null,
  warnings: [],
  set: (patch) => set(patch),
}));

export interface PdfToTextSettings {
  mode: 'paragraphs' | 'layout';
  ocr: boolean;
  pageMarkers: boolean;
  update: (patch: Partial<Omit<PdfToTextSettings, 'update'>>) => void;
}

export const usePdfToTextSettings = create<PdfToTextSettings>()(
  persist((set) => ({ mode: 'paragraphs', ocr: true, pageMarkers: false, update: (patch) => set(patch) }), {
    name: 'compresskit-pdf-to-text',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ mode: s.mode, ocr: s.ocr, pageMarkers: s.pageMarkers }),
  }),
);

export interface PdfToHtmlSettings {
  images: boolean;
  ocr: boolean;
  update: (patch: Partial<Omit<PdfToHtmlSettings, 'update'>>) => void;
}

export const usePdfToHtmlSettings = create<PdfToHtmlSettings>()(
  persist((set) => ({ images: true, ocr: true, update: (patch) => set(patch) }), {
    name: 'compresskit-pdf-to-html',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ images: s.images, ocr: s.ocr }),
  }),
);
