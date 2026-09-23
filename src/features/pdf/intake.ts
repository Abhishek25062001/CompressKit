import { CONVERT_INPUT_FORMATS, detectFormat, getExtension, type FormatDef } from '../../constants/formats';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { PdfOpenError, openPdf } from './documents';
import { renderThumbnail } from './render';

const PDF_FORMAT: FormatDef = { kind: 'image', label: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'] };
/** Photos, including iPhone HEIC, become one page each. */
const PHOTO_FORMATS = CONVERT_INPUT_FORMATS.filter((f) => f.kind === 'image');
export const PDF_INPUT_FORMATS: FormatDef[] = [PDF_FORMAT, ...PHOTO_FORMATS];
export const PDF_BADGES = ['PDF', 'JPG', 'PNG', 'WebP', 'HEIC', 'AVIF', 'BMP'];

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

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || getExtension(file.name) === 'pdf';
}

/** Adds PDFs (every page) and photos (one page each) to the end of the board, in the order given. */
export async function addPdfFiles(files: Iterable<File>): Promise<void> {
  const notice = useUiStore.getState().pushNotice;
  const skipped: string[] = [];
  const locked: string[] = [];
  const broken: string[] = [];

  for (const file of files) {
    const pdf = isPdf(file);
    if (!pdf && !detectFormat(file, PHOTO_FORMATS)) {
      skipped.push(file.name);
      continue;
    }
    const sourceId = createId();
    let pageCount = 1;
    if (pdf) {
      usePdfStore.getState().setBusy(`Reading ${file.name}`);
      try {
        pageCount = (await openPdf(sourceId, file)).view.numPages;
      } catch (e) {
        (e instanceof PdfOpenError && e.reason === 'encrypted' ? locked : broken).push(file.name);
        console.warn('[CompressKit] could not open PDF:', e);
        continue;
      } finally {
        usePdfStore.getState().setBusy(null);
      }
    }
    const source: PdfSource = { id: sourceId, name: file.name, kind: pdf ? 'pdf' : 'image', file, pageCount };
    const pages: PdfPage[] = Array.from({ length: pageCount }, (_, index) => ({
      id: createId(),
      sourceId,
      index,
      rotation: 0,
      selected: false,
      thumbUrl: null,
    }));
    usePdfStore.getState().addSource(source, pages);
    thumbQueue.push(...pages);
    pumpThumbnails();
  }

  if (skipped.length) {
    notice({ tone: 'warning', title: `${skipped.length === 1 ? '1 file was' : `${skipped.length} files were`} skipped`, message: `Not a PDF or photo: ${skipped.slice(0, 3).join(', ')}` });
  }
  if (locked.length) {
    notice({
      tone: 'warning',
      title: 'Password-protected PDFs are not supported',
      message: `Remove the protection first, then add it again: ${locked.slice(0, 3).join(', ')}`,
    });
  }
  if (broken.length) {
    notice({ tone: 'error', title: "We couldn't read this PDF", message: `The file may be damaged: ${broken.slice(0, 3).join(', ')}` });
  }
}
