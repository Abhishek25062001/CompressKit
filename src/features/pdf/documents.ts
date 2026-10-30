import type { PDFDocument } from '@cantoo/pdf-lib';
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
    readonly reason: 'encrypted' | 'wrong-password' | 'invalid',
    detail: string,
  ) {
    super(detail);
    this.name = 'PdfOpenError';
  }
}

/**
 * Loads a PDF with pdf-lib. Many PDFs open in any viewer without a password but are still
 * encrypted, with only an owner password limiting printing or editing. Viewers try an empty
 * password first; pdf-lib only decrypts when given one, so without a password the empty one is
 * tried. Only a PDF that really needs a password to open throws `encrypted`.
 */
export async function loadPdfLib(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, password: password ?? '' });
  } catch (e) {
    // The library's error classes are not reliable with `instanceof` across builds, so match the message.
    const text = String(e);
    const needsPassword = /password incorrect|needs password|is encrypted/i.test(text);
    throw new PdfOpenError(needsPassword ? (password ? 'wrong-password' : 'encrypted') : 'invalid', text);
  }
}

/**
 * Opens a PDF for viewing and editing. A password-protected PDF needs its password; once open,
 * its pages are decrypted, so copies made from it are not protected unless a password is added.
 */
export async function openPdf(sourceId: string, file: File, password?: string): Promise<OpenPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [edit, pdfjs] = await Promise.all([loadPdfLib(bytes, password), loadPdfjs()]);
  let view: PDFDocumentProxy;
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    view = await pdfjs.getDocument({ data: bytes.slice(), password }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    throw new PdfOpenError(name === 'PasswordException' ? (password ? 'wrong-password' : 'encrypted') : 'invalid', String(e));
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

/** Releases a PDF opened outside the page board, such as one being converted to Word. */
export function closePdf(sourceId: string): void {
  void open.get(sourceId)?.view.loadingTask.destroy();
  open.delete(sourceId);
}

setPdfReleaseListener((ids) => ids.forEach(closePdf));
