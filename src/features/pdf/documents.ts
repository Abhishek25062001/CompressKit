import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { setPdfReleaseListener } from '../../store/pdfStore';

/**
 * Parsed documents per source, kept out of the store because they are large and not serializable.
 * pdf.js renders pages (thumbnails, images); pdf-lib copies pages into new PDFs.
 */
interface OpenPdf {
  view: PDFDocumentProxy;
  edit: PDFDocument;
}

const open = new Map<string, OpenPdf>();

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** Loads pdf.js (about 1.5 MB with its worker) only when the PDF tool is first used. */
export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return pdfjsPromise;
}

export class PdfOpenError extends Error {
  constructor(
    readonly reason: 'encrypted' | 'invalid',
    detail: string,
  ) {
    super(detail);
    this.name = 'PdfOpenError';
  }
}

export async function openPdf(sourceId: string, file: File): Promise<OpenPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [{ PDFDocument }, pdfjs] = await Promise.all([import('pdf-lib'), loadPdfjs()]);
  let edit: PDFDocument;
  try {
    edit = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // pdf-lib's error classes fail `instanceof` in its published build, so match the message.
    const encrypted = /is encrypted/i.test(String(e));
    throw new PdfOpenError(encrypted ? 'encrypted' : 'invalid', String(e));
  }
  let view: PDFDocumentProxy;
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    view = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    throw new PdfOpenError(name === 'PasswordException' ? 'encrypted' : 'invalid', String(e));
  }
  const doc = { view, edit };
  open.set(sourceId, doc);
  return doc;
}

export function getOpenPdf(sourceId: string): OpenPdf {
  const doc = open.get(sourceId);
  if (!doc) throw new Error(`PDF ${sourceId} is not open`);
  return doc;
}

setPdfReleaseListener((ids) => {
  for (const id of ids) {
    void open.get(id)?.view.loadingTask.destroy();
    open.delete(id);
  }
});
