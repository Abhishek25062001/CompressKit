import { A4, concatDocs, paragraph, type DocModel, type PageSetup } from './model';
import { DOC_QUEUES, useDocEditorStore, useHtmlToPdfSettings, usePdfToDocxSettings, useTextToPdfSettings, type ConvertKind, type DocJob } from '../../store/docsStore';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import { downloadBlob } from '../../utils/download';
import { sanitizeBaseName } from '../../utils/filename';
import { createZip } from '../../utils/zip';
import { PdfOpenError } from '../pdf/documents';
import { askPassword } from '../pdf/passwordPrompt';
import { DocxReadError, isDocx, readDocx } from './docxRead';
import { writeDocx } from './docxWrite';
import { isHtml, isPlainText, isRtf } from './formats';

const tick = () => new Promise((r) => setTimeout(r, 0));

const WARNING_TEXT = (warnings: string[]) => `Not carried over: ${warnings.join(', ')}.`;
const RASTER_NOTE = 'Some characters (symbols or non-Latin scripts) were drawn as pictures: they show correctly but cannot be selected.';

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** A failure explained in words for the file's card. */
export class ConvertError extends Error {}

type Result = NonNullable<DocJob['result']> & { notes?: string[] };
type Progress = (ratio: number, stage?: string) => void;

interface Converter {
  accepts: (file: File) => boolean;
  /** Shown when dropped files are not accepted. */
  takes: string;
  convert: (file: File, progress: Progress) => Promise<Result>;
  /** Shown when something unexpected fails. */
  failure: string;
}

const pdfResult = (bytes: Uint8Array, name: string, pages: number, notes: string[] = []): Result => ({
  blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
  name,
  pages,
  notes,
});

/** Lays out a document model as a PDF named after the file. */
async function docToPdf(doc: DocModel, file: File, progress: Progress, notes: string[] = []): Promise<Result> {
  progress(0.3, 'Laying out pages');
  const { layoutPdf } = await import('./pdfLayout');
  const base = sanitizeBaseName(file.name);
  const result = await layoutPdf(doc, { title: base, onProgress: (r) => progress(0.3 + r * 0.65) });
  if (result.rasterWords) notes.push(RASTER_NOTE);
  return pdfResult(result.bytes, `${base}.pdf`, result.pages, notes);
}

/** Runs a PDF converter, asking for the password of a locked PDF until it is right or skipped. */
export async function withPdfPassword<T>(file: File, progress: Progress, attempt: (password: string | undefined) => Promise<T>): Promise<T> {
  let password: string | undefined;
  for (;;) {
    try {
      return await attempt(password);
    } catch (e) {
      if (e instanceof PdfOpenError && e.reason !== 'invalid') {
        progress(0.02, 'Waiting for password');
        const answer = await askPassword(file.name, e.reason === 'wrong-password');
        if (answer === null) throw new ConvertError('This PDF is locked and no password was given.');
        password = answer;
        continue;
      }
      if (e instanceof PdfOpenError) throw new ConvertError("This isn't a PDF, or it is damaged.");
      throw e;
    }
  }
}

const pageFor = (size: 'a4' | 'letter'): PageSetup =>
  size === 'letter' ? { width: 612, height: 792, margin: { ...A4.margin } } : { ...A4, margin: { ...A4.margin } };

export const CONVERTERS: Record<ConvertKind, Converter> = {
  'docx-to-pdf': {
    accepts: (f) => isDocx(f) || /\.doc$/i.test(f.name),
    takes: 'Word to PDF takes .docx files.',
    failure: 'The document could not be converted. It may be too large for this browser.',
    async convert(file, progress) {
      progress(0.05, 'Reading document');
      try {
        const { doc, warnings } = await readDocx(file);
        return await docToPdf(doc, file, progress, warnings.length ? [WARNING_TEXT(warnings)] : []);
      } catch (e) {
        if (e instanceof DocxReadError) {
          throw new ConvertError(
            /\.doc$/i.test(file.name)
              ? 'This is an old .doc file. Open it in Word or Google Docs and save it as .docx first.'
              : "This isn't a Word (.docx) document, or it is damaged.",
          );
        }
        throw e;
      }
    },
  },
  'pdf-to-docx': {
    accepts: isPdfFile,
    takes: 'PDF to Word takes PDF files.',
    failure: 'The PDF could not be converted. It may be too large for this browser.',
    async convert(file, progress) {
      const settings = usePdfToDocxSettings.getState();
      progress(0.02, 'Opening PDF');
      const { pdfToDoc } = await import('./pdfExtract');
      const result = await withPdfPassword(file, progress, (password) =>
        pdfToDoc(file, {
          images: settings.images,
          ocr: settings.ocr,
          pageBreaks: settings.keepPages,
          password,
          onProgress: (r, stage) => progress(0.02 + r * 0.9, stage),
        }),
      );
      progress(0.95, 'Writing Word file');
      await tick();
      const base = sanitizeBaseName(file.name);
      const notes: string[] = [];
      if (result.scannedPages) {
        const pictures = result.scannedPages - result.ocrPages;
        if (result.ocrPages) notes.push(`${result.ocrPages} scanned page${result.ocrPages === 1 ? ' was' : 's were'} read with OCR; check the text for mistakes.`);
        if (pictures) notes.push(`${pictures} page${pictures === 1 ? ' has' : 's have'} no text to edit and ${pictures === 1 ? 'was' : 'were'} kept as a picture.`);
      }
      return { blob: writeDocx(result.doc, base), name: `${base}.docx`, pages: result.pages, notes };
    },
  },
  'text-to-pdf': {
    accepts: isPlainText,
    takes: 'Text to PDF takes plain text (.txt) and Markdown (.md) files.',
    failure: 'The text could not be converted. It may be too large for this browser.',
    async convert(file, progress) {
      progress(0.05, 'Reading text');
      const { readTextFile } = await import('./textRead');
      const { font, size, page } = useTextToPdfSettings.getState();
      const doc = await readTextFile(file, { font, size, page });
      return docToPdf(doc, file, progress);
    },
  },
  'rtf-to-pdf': {
    accepts: isRtf,
    takes: 'RTF to PDF takes Rich Text (.rtf) files.',
    failure: 'The document could not be converted. It may be too large for this browser.',
    async convert(file, progress) {
      progress(0.05, 'Reading document');
      const { readRtf, RtfReadError } = await import('./rtfRead');
      try {
        const { doc, warnings } = readRtf(new Uint8Array(await file.arrayBuffer()));
        return await docToPdf(doc, file, progress, warnings.length ? [WARNING_TEXT(warnings)] : []);
      } catch (e) {
        if (e instanceof RtfReadError) throw new ConvertError("This isn't a Rich Text (.rtf) document, or it is damaged.");
        throw e;
      }
    },
  },
  'html-to-pdf': {
    accepts: isHtml,
    takes: 'HTML to PDF takes web page files (.html or .htm).',
    failure: 'The page could not be converted. It may be too large for this browser.',
    async convert(file, progress) {
      progress(0.05, 'Reading page');
      const { decodeHtml, readHtml } = await import('./htmlRead');
      const source = decodeHtml(new Uint8Array(await file.arrayBuffer()));
      progress(0.15, 'Applying styles');
      const { doc, warnings } = await readHtml(source, pageFor(useHtmlToPdfSettings.getState().page));
      return docToPdf(doc, file, progress, warnings.length ? [WARNING_TEXT(warnings)] : []);
    },
  },
};

/** Converts one file on a converter's list. */
async function runJob(kind: ConvertKind, id: string): Promise<void> {
  const queue = DOC_QUEUES[kind];
  const job = queue.getState().jobs.find((j) => j.id === id);
  if (!job) return;
  const { update } = queue.getState();
  const converter = CONVERTERS[kind];
  update(id, { status: 'working', progress: 0.02, stage: undefined });
  try {
    const { notes, ...result } = await converter.convert(job.file, (ratio, stage) => update(id, { progress: ratio, ...(stage ? { stage } : {}) }));
    update(id, { status: 'done', progress: 1, stage: undefined, result, notes: notes ?? [] });
  } catch (e) {
    if (!(e instanceof ConvertError)) console.warn(`[CompressKit] ${kind} failed:`, e);
    update(id, { status: 'failed', stage: undefined, error: e instanceof ConvertError ? e.message : converter.failure });
  }
}

const running = new Set<ConvertKind>();

/** Works through waiting files one at a time; files added meanwhile are picked up too. */
async function runQueue(kind: ConvertKind): Promise<void> {
  if (running.has(kind)) return;
  running.add(kind);
  try {
    for (;;) {
      const next = DOC_QUEUES[kind].getState().jobs.find((j) => j.status === 'waiting');
      if (!next) break;
      await runJob(kind, next.id);
    }
  } finally {
    running.delete(kind);
  }
}

/** Adds files to a converter's list and starts converting. Files it cannot take are skipped with a notice. */
export function addToConverter(kind: ConvertKind, files: File[]): void {
  const { accepts, takes } = CONVERTERS[kind];
  const accepted = files.filter(accepts);
  const skipped = files.length - accepted.length;
  if (skipped) useUiStore.getState().pushNotice({ tone: 'warning', title: `${skipped === 1 ? '1 file was' : `${skipped} files were`} skipped`, message: takes });
  if (!accepted.length) return;
  DOC_QUEUES[kind].getState().add(accepted);
  void runQueue(kind);
}

/** Converts a file again, for example after changing the options. */
export function retryJob(kind: ConvertKind, id: string): void {
  DOC_QUEUES[kind].getState().update(id, { status: 'waiting', progress: 0, error: undefined, notes: undefined, result: undefined });
  void runQueue(kind);
}

export async function downloadAllJobs(kind: ConvertKind): Promise<void> {
  const done = DOC_QUEUES[kind].getState().jobs.flatMap((j) => (j.result ? [j.result] : []));
  if (done.length === 1) downloadBlob(done[0].blob, done[0].name);
  else if (done.length) downloadBlob(await createZip(done.map((r) => ({ name: r.name, blob: r.blob }))), `compresskit-${kind}.zip`);
}

// ---------------------------------------------------------------------------------------------
// The Word editor.

/** Opens a Word file, a PDF (converted to editable text) or a blank page in the editor. */
export async function openInEditor(file: File | null): Promise<void> {
  const editor = useDocEditorStore.getState();
  if (!file) {
    editor.set({ name: 'Untitled document', doc: { page: A4, blocks: [paragraph()] }, version: editor.version + 1, warnings: [] });
    return;
  }
  const name = sanitizeBaseName(file.name);
  editor.set({ loading: `Opening ${file.name}` });
  try {
    if (isPdfFile(file)) {
      const { pdfToDoc } = await import('./pdfExtract');
      let password: string | undefined;
      for (;;) {
        try {
          const settings = usePdfToDocxSettings.getState();
          const result = await pdfToDoc(file, {
            images: true,
            ocr: settings.ocr,
            password,
            onProgress: (_, stage) => stage && useDocEditorStore.getState().set({ loading: stage }),
          });
          useDocEditorStore.getState().set({ name, doc: result.doc, version: useDocEditorStore.getState().version + 1, warnings: [] });
          return;
        } catch (e) {
          if (e instanceof PdfOpenError && e.reason !== 'invalid') {
            const answer = await askPassword(file.name, e.reason === 'wrong-password');
            if (answer !== null) {
              password = answer;
              continue;
            }
            return;
          }
          throw e;
        }
      }
    }
    const { doc, warnings } = await readDocx(file);
    useDocEditorStore.getState().set({ name, doc, version: useDocEditorStore.getState().version + 1, warnings });
  } catch (e) {
    console.warn('[CompressKit] could not open document:', e);
    useUiStore.getState().pushNotice({
      tone: 'error',
      title: "We couldn't open this file",
      message: /\.doc$/i.test(file.name)
        ? 'Old .doc files need saving as .docx in Word or Google Docs first.'
        : 'Pick a Word (.docx) document or a PDF. The file may be damaged.',
    });
  } finally {
    useDocEditorStore.getState().set({ loading: null });
  }
}

// ---------------------------------------------------------------------------------------------
// Merging Word files.

/** Joins the Word files on the board into one .docx, in the order their pages appear. */
export function mergeWordFiles(): void {
  const { pages, sources, wordDocs } = usePdfStore.getState();
  const order: string[] = [];
  for (const p of pages) if (!order.includes(p.sourceId)) order.push(p.sourceId);
  const docs = order.flatMap((id) => (wordDocs[id] ? [wordDocs[id]] : []));
  if (!docs.length) return;
  const first = sources[order[0]];
  const name = docs.length === 1 && first ? sanitizeBaseName(first.name) : `compresskit-merged-${new Date().toISOString().slice(0, 10)}`;
  downloadBlob(writeDocx(concatDocs(docs), name), `${name}.docx`);
}
