import { CONVERT_INPUT_FORMATS, detectFormat, getExtension, type FormatDef } from '../../constants/formats';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { DocxReadError, isDocx, readDocx } from '../docs/docxRead';
import { PdfOpenError, openPdf } from './documents';
import { askPassword } from './passwordPrompt';
import { renderThumbnail } from './render';

export const PDF_FORMAT: FormatDef = { kind: 'image', label: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'] };
export const DOCX_FORMAT: FormatDef = {
  kind: 'image',
  label: 'DOCX',
  mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  extensions: ['docx'],
};
/** Photos, including iPhone HEIC, become one page each. */
const PHOTO_FORMATS = CONVERT_INPUT_FORMATS.filter((f) => f.kind === 'image');
/** Word documents are laid out as PDF pages when they are added. */
export const PDF_INPUT_FORMATS: FormatDef[] = [PDF_FORMAT, DOCX_FORMAT, ...PHOTO_FORMATS];
export const PDF_BADGES = ['PDF', 'DOCX', 'JPG', 'PNG', 'WebP', 'HEIC', 'AVIF'];

const THUMB_CONCURRENCY = 2;
const thumbQueue: PdfPage[] = [];
let thumbWorkers = 0;

function pumpThumbnails(): void {
  while (thumbWorkers < THUMB_CONCURRENCY && thumbQueue.length) {
    const page = thumbQueue.shift()!;
    thumbWorkers++;
    void (async () => {
      try {
        const source = usePdfStore.getState().sources[page.sourceId];
        if (!source || !usePdfStore.getState().pages.some((p) => p.id === page.id)) return;
        const url = await renderThumbnail(page, source);
        // The page may have been removed while rendering.
        if (usePdfStore.getState().pages.some((p) => p.id === page.id)) usePdfStore.getState().updatePage(page.id, { thumbUrl: url });
        else URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('[CompressKit] thumbnail failed:', e);
      } finally {
        thumbWorkers--;
        pumpThumbnails();
      }
    })();
  }
}

/** Redraws a page's thumbnail, for example after its scan cleanup changed. */
export function refreshThumbnail(pageId: string): void {
  const store = usePdfStore.getState();
  const page = store.pages.find((p) => p.id === pageId);
  if (!page) return;
  if (page.thumbUrl) URL.revokeObjectURL(page.thumbUrl);
  store.updatePage(pageId, { thumbUrl: null });
  thumbQueue.push(usePdfStore.getState().pages.find((p) => p.id === pageId)!);
  pumpThumbnails();
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || getExtension(file.name) === 'pdf';
}

function addPages(source: PdfSource): void {
  const pages: PdfPage[] = Array.from({ length: source.pageCount }, (_, index) => ({
    id: createId(),
    sourceId: source.id,
    index,
    rotation: 0,
    selected: false,
    thumbUrl: null,
    signatures: [],
  }));
  usePdfStore.getState().addSource(source, pages);
  thumbQueue.push(...pages);
  pumpThumbnails();
}

/**
 * Adds PDFs (every page), Word documents (laid out as pages) and photos (one page each) to the end
 * of the board, in the order given.
 */
export async function addPdfFiles(files: Iterable<File>): Promise<void> {
  const notice = useUiStore.getState().pushNotice;
  const wordWarnings: string[] = [];
  const skipped: string[] = [];
  const locked: string[] = [];
  const broken: string[] = [];
  const unlocked: string[] = [];

  for (const file of files) {
    const word = isDocx(file);
    const pdf = isPdf(file);
    if (!pdf && !word && !detectFormat(file, PHOTO_FORMATS)) {
      skipped.push(file.name);
      continue;
    }
    const sourceId = createId();
    let pageCount = 1;
    if (word) {
      usePdfStore.getState().setBusy(`Reading ${file.name}`);
      try {
        const { doc, warnings } = await readDocx(file);
        const { layoutPdf } = await import('../docs/pdfLayout');
        const { bytes } = await layoutPdf(doc);
        // The board works on PDF pages, so the Word file is kept as the PDF it was laid out as.
        const laidOut = new File([bytes as BlobPart], file.name, { type: 'application/pdf' });
        pageCount = (await openPdf(sourceId, laidOut)).view.numPages;
        usePdfStore.setState((s) => ({ wordDocs: { ...s.wordDocs, [sourceId]: doc } }));
        const source: PdfSource = { id: sourceId, name: file.name, kind: 'pdf', file: laidOut, pageCount };
        addPages(source);
        if (warnings.length) wordWarnings.push(`${file.name}: ${warnings.join(', ')}`);
      } catch (e) {
        broken.push(file.name);
        if (!(e instanceof DocxReadError)) console.warn('[CompressKit] could not read Word file:', e);
      } finally {
        usePdfStore.getState().setBusy(null);
      }
      continue;
    }
    if (pdf) {
      let password: string | undefined;
      let opened = false;
      // Locked PDFs ask for their password until it is right or the file is skipped.
      for (;;) {
        usePdfStore.getState().setBusy(`Reading ${file.name}`);
        try {
          pageCount = (await openPdf(sourceId, file, password)).view.numPages;
          opened = true;
          if (password) unlocked.push(file.name);
          break;
        } catch (e) {
          usePdfStore.getState().setBusy(null);
          if (e instanceof PdfOpenError && e.reason !== 'invalid') {
            const answer = await askPassword(file.name, e.reason === 'wrong-password');
            if (answer === null) {
              locked.push(file.name);
              break;
            }
            password = answer;
            continue;
          }
          broken.push(file.name);
          console.warn('[CompressKit] could not open PDF:', e);
          break;
        } finally {
          usePdfStore.getState().setBusy(null);
        }
      }
      if (!opened) continue;
    }
    addPages({ id: sourceId, name: file.name, kind: pdf ? 'pdf' : 'image', file, pageCount });
  }

  if (skipped.length) {
    notice({
      tone: 'warning',
      title: `${skipped.length === 1 ? '1 file was' : `${skipped.length} files were`} skipped`,
      message: `Not a PDF, Word document or photo: ${skipped.slice(0, 3).join(', ')}${skipped.some((n) => /\.doc$/i.test(n)) ? '. Old .doc files need saving as .docx in Word first.' : ''}`,
    });
  }
  if (wordWarnings.length) {
    notice({ tone: 'info', title: 'Some Word content was left out', message: `${wordWarnings.slice(0, 2).join('; ')}.` });
  }
  if (locked.length) {
    notice({
      tone: 'warning',
      title: `${locked.length === 1 ? 'A locked PDF was' : 'Locked PDFs were'} skipped`,
      message: `No password was given for: ${locked.slice(0, 3).join(', ')}`,
    });
  }
  if (unlocked.length) {
    notice({
      tone: 'info',
      title: 'PDF unlocked',
      message: `${unlocked.slice(0, 3).join(', ')}: files you save from it have no password. Add one under Protect if you need it.`,
    });
  }
  if (broken.length) {
    notice({ tone: 'error', title: "We couldn't read this file", message: `It may be damaged: ${broken.slice(0, 3).join(', ')}` });
  }
}
