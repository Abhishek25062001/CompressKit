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
