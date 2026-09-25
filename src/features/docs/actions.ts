import type { StoreApi, UseBoundStore } from 'zustand';
import { useDocEditorStore, useDocxToPdfStore, usePdfToDocxSettings, usePdfToDocxStore, type DocQueueState } from '../../store/docsStore';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import { downloadBlob } from '../../utils/download';
import { sanitizeBaseName } from '../../utils/filename';
import { createZip } from '../../utils/zip';
import { PdfOpenError } from '../pdf/documents';
import { askPassword } from '../pdf/passwordPrompt';
import { DocxReadError, isDocx, readDocx } from './docxRead';
import { writeDocx } from './docxWrite';
import { A4, concatDocs, paragraph } from './model';

type Queue = UseBoundStore<StoreApi<DocQueueState>>;

const tick = () => new Promise((r) => setTimeout(r, 0));

const WARNING_TEXT = (warnings: string[]) => `Not carried over: ${warnings.join(', ')}.`;

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Converts one Word file to PDF. */
async function docxToPdf(queue: Queue, id: string): Promise<void> {
  const job = queue.getState().jobs.find((j) => j.id === id);
  if (!job) return;
  const { update } = queue.getState();
  update(id, { status: 'working', progress: 0.05, stage: 'Reading document' });
  try {
    const { doc, warnings } = await readDocx(job.file);
    update(id, { progress: 0.3, stage: 'Laying out pages' });
    const { layoutPdf } = await import('./pdfLayout');
    const base = sanitizeBaseName(job.file.name);
    const result = await layoutPdf(doc, { title: base, onProgress: (r) => update(id, { progress: 0.3 + r * 0.65 }) });
    const notes = warnings.length ? [WARNING_TEXT(warnings)] : [];
    if (result.rasterWords) notes.push('Text in some scripts was drawn as pictures, so it is visible but not selectable.');
    update(id, {
      status: 'done',
      progress: 1,
      stage: undefined,
      result: { blob: new Blob([result.bytes as BlobPart], { type: 'application/pdf' }), name: `${base}.pdf`, pages: result.pages },
      notes,
    });
  } catch (e) {
    console.warn('[CompressKit] Word to PDF failed:', e);
    update(id, {
      status: 'failed',
      stage: undefined,
      error:
        e instanceof DocxReadError
          ? /\.doc$/i.test(job.file.name)
            ? 'This is an old .doc file. Open it in Word or Google Docs and save it as .docx first.'
            : "This isn't a Word (.docx) document, or it is damaged."
          : 'The document could not be converted. It may be too large for this browser.',
    });
  }
}

/** Converts one PDF to Word, asking for its password when it is locked. */
async function pdfToDocx(queue: Queue, id: string): Promise<void> {
  const job = queue.getState().jobs.find((j) => j.id === id);
  if (!job) return;
  const { update } = queue.getState();
  const settings = usePdfToDocxSettings.getState();
  update(id, { status: 'working', progress: 0.02, stage: 'Opening PDF' });
  const { pdfToDoc } = await import('./pdfExtract');
  let password: string | undefined;
  for (;;) {
    try {
      const result = await pdfToDoc(job.file, {
        images: settings.images,
        ocr: settings.ocr,
        pageBreaks: settings.keepPages,
        password,
        onProgress: (r, stage) => update(id, { progress: 0.02 + r * 0.9, ...(stage ? { stage } : {}) }),
      });
      update(id, { stage: 'Writing Word file', progress: 0.95 });
      await tick();
      const base = sanitizeBaseName(job.file.name);
      const notes: string[] = [];
      if (result.scannedPages) {
        const pictures = result.scannedPages - result.ocrPages;
        if (result.ocrPages) notes.push(`${result.ocrPages} scanned page${result.ocrPages === 1 ? ' was' : 's were'} read with OCR; check the text for mistakes.`);
        if (pictures) notes.push(`${pictures} page${pictures === 1 ? ' has' : 's have'} no text to edit and ${pictures === 1 ? 'was' : 'were'} kept as a picture.`);
      }
      update(id, {
        status: 'done',
        progress: 1,
        stage: undefined,
        result: { blob: writeDocx(result.doc, base), name: `${base}.docx`, pages: result.pages },
        notes,
      });
      return;
    } catch (e) {
      if (e instanceof PdfOpenError && e.reason !== 'invalid') {
        update(id, { stage: 'Waiting for password' });
        const answer = await askPassword(job.file.name, e.reason === 'wrong-password');
        if (answer !== null) {
          password = answer;
          continue;
        }
        update(id, { status: 'failed', stage: undefined, error: 'This PDF is locked and no password was given.' });
        return;
      }
      console.warn('[CompressKit] PDF to Word failed:', e);
      update(id, {
        status: 'failed',
        stage: undefined,
        error: e instanceof PdfOpenError ? "This isn't a PDF, or it is damaged." : 'The PDF could not be converted. It may be too large for this browser.',
      });
      return;
    }
  }
}

const running = new WeakSet<Queue>();

/** Works through waiting files one at a time; files added meanwhile are picked up too. */
async function runQueue(queue: Queue, convert: (queue: Queue, id: string) => Promise<void>): Promise<void> {
  if (running.has(queue)) return;
  running.add(queue);
  try {
    for (;;) {
      const next = queue.getState().jobs.find((j) => j.status === 'waiting');
      if (!next) break;
      await convert(queue, next.id);
    }
  } finally {
    running.delete(queue);
  }
}

export function addDocxToPdf(files: File[]): void {
  const accepted = files.filter((f) => isDocx(f) || /\.doc$/i.test(f.name));
  const skipped = files.length - accepted.length;
  if (skipped) useUiStore.getState().pushNotice({ tone: 'warning', title: `${skipped === 1 ? '1 file was' : `${skipped} files were`} skipped`, message: 'Word to PDF takes .docx files.' });
  if (!accepted.length) return;
  useDocxToPdfStore.getState().add(accepted);
  void runQueue(useDocxToPdfStore, docxToPdf);
}

export function addPdfToDocx(files: File[]): void {
  const accepted = files.filter(isPdfFile);
  const skipped = files.length - accepted.length;
  if (skipped) useUiStore.getState().pushNotice({ tone: 'warning', title: `${skipped === 1 ? '1 file was' : `${skipped} files were`} skipped`, message: 'PDF to Word takes PDF files.' });
  if (!accepted.length) return;
  usePdfToDocxStore.getState().add(accepted);
  void runQueue(usePdfToDocxStore, pdfToDocx);
}

/** Converts a file again, for example after changing the options. */
export function retryJob(kind: 'docx-to-pdf' | 'pdf-to-docx', id: string): void {
  const queue = kind === 'docx-to-pdf' ? useDocxToPdfStore : usePdfToDocxStore;
  queue.getState().update(id, { status: 'waiting', progress: 0, error: undefined, notes: undefined, result: undefined });
  void runQueue(queue, kind === 'docx-to-pdf' ? docxToPdf : pdfToDocx);
}

export async function downloadAllJobs(kind: 'docx-to-pdf' | 'pdf-to-docx'): Promise<void> {
  const queue = kind === 'docx-to-pdf' ? useDocxToPdfStore : usePdfToDocxStore;
  const done = queue.getState().jobs.flatMap((j) => (j.result ? [j.result] : []));
  if (done.length === 1) downloadBlob(done[0].blob, done[0].name);
  else if (done.length) downloadBlob(await createZip(done.map((r) => ({ name: r.name, blob: r.blob }))), `compresskit-${kind === 'docx-to-pdf' ? 'pdf' : 'word'}.zip`);
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
