import { CONVERT_INPUT_FORMATS, detectFormat, getExtension, type FormatDef } from '../../constants/formats';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { DocxReadError, isDocx, readDocx } from '../docs/docxRead';
import { decodeTiff, GIF_FORMAT, isAnimatedGif, isTiff, TIFF_FORMAT } from './imageFormats';
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
/** Photos, including iPhone HEIC, and GIFs become one page each; TIFFs one page per page in the file. */
const PHOTO_FORMATS = [...CONVERT_INPUT_FORMATS.filter((f) => f.kind === 'image'), GIF_FORMAT, TIFF_FORMAT];
/** Word documents are laid out as PDF pages when they are added. */
export const PDF_INPUT_FORMATS: FormatDef[] = [PDF_FORMAT, DOCX_FORMAT, ...PHOTO_FORMATS];
export const PDF_BADGES = ['PDF', 'DOCX', 'JPG', 'PNG', 'WebP', 'HEIC', 'TIFF', 'GIF'];

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
        console.warn('[ofctools] thumbnail failed:', e);
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
  const animated: string[] = [];
  const partialTiffs: string[] = [];

  for (const file of files) {
    const word = isDocx(file);
    const pdf = isPdf(file);
    if (!pdf && !word && !detectFormat(file, PHOTO_FORMATS)) {
      skipped.push(file.name);
      continue;
    }
    const sourceId = createId();
    let pageCount = 1;
    if (isTiff(file)) {
      usePdfStore.getState().setBusy(`Reading ${file.name}`);
      try {
        const result = await decodeTiff(file);
        if (!result.ok || !result.pages.length) {
          if (!result.ok) console.warn('[ofctools] could not read TIFF:', result.error);
          broken.push(file.name);
          continue;
        }
        if (result.tooLarge || result.failed) partialTiffs.push(file.name);
        const base = file.name.replace(/\.tiff?$/i, '');
        // Each TIFF page becomes a photo source of its own, so it can be moved, rotated or removed alone.
        result.pages.forEach((page, n) => {
          const multi = result.pages.length > 1;
          addPages({
            id: n === 0 ? sourceId : createId(),
            name: multi ? `${file.name} · p. ${n + 1}` : file.name,
            kind: 'image',
            file: new File([page.blob], `${base}${multi ? `-page-${n + 1}` : ''}.png`, { type: 'image/png' }),
            pageCount: 1,
          });
        });
      } finally {
        usePdfStore.getState().setBusy(null);
      }
      continue;
    }
    if (detectFormat(file, [GIF_FORMAT]) && (await isAnimatedGif(file))) animated.push(file.name);
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
        if (!(e instanceof DocxReadError)) console.warn('[ofctools] could not read Word file:', e);
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
          console.warn('[ofctools] could not open PDF:', e);
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
      message: `Not a PDF, Word document or picture: ${skipped.slice(0, 3).join(', ')}${skipped.some((n) => /\.doc$/i.test(n)) ? '. Old .doc files need saving as .docx in Word first.' : ''}`,
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
  if (animated.length) {
    notice({
      tone: 'info',
      title: 'Animated GIF added as one page',
      message: `${animated.slice(0, 3).join(', ')}: a PDF page can't move, so the first frame was used.`,
    });
  }
  if (partialTiffs.length) {
    notice({
      tone: 'warning',
      title: 'Some TIFF pages were left out',
      message: `${partialTiffs.slice(0, 3).join(', ')}: a page was too large for this browser or used an unsupported format.`,
    });
  }
  if (broken.length) {
    notice({ tone: 'error', title: "We couldn't read this file", message: `It may be damaged: ${broken.slice(0, 3).join(', ')}` });
  }
}
