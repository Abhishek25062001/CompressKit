import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, PdfSettings, PdfSource } from '../../types/pdf';
import { downloadBlob } from '../../utils/download';
import { sanitizeBaseName } from '../../utils/filename';
import { createZip } from '../../utils/zip';
import { canvasToBlob, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';
import { hasTransparency } from '../image/resize';
import { getOpenPdf } from './documents';
import { renderPage } from './render';

/** Page sizes in PDF points (1/72 inch). */
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MARGINS = { none: 0, small: 18, large: 36 } as const;
/** "Standard" photo quality: about 200 DPI across an A4 page, plenty for reading and printing documents. */
const STANDARD_LONG_SIDE = 2339;

type LibDocument = import('pdf-lib').PDFDocument;

/** Base name for downloads: the file's own name when everything came from one file. */
function baseName(pages: PdfPage[]): string {
  const { sources } = usePdfStore.getState();
  const ids = new Set(pages.map((p) => p.sourceId));
  if (ids.size === 1) return sanitizeBaseName(sources[[...ids][0]].name);
  return `compresskit-${new Date().toISOString().slice(0, 10)}`;
}

/** Yields to the browser so progress can paint during long synchronous PDF work. */
const tick = () => new Promise((r) => setTimeout(r, 0));

async function embedPhoto(out: LibDocument, source: PdfSource, settings: PdfSettings) {
  // Decoding applies EXIF orientation, which PDF viewers would otherwise ignore for phone photos.
  const probe = await renderPage({ sourceId: source.id, index: 0 }, source, 1, 0, null);
  const longSide = Math.max(probe.width, probe.height);
  let canvas: AnyCanvas = probe;
  if (settings.photoQuality === 'standard' && longSide > STANDARD_LONG_SIDE) {
    releaseCanvas(probe);
    canvas = await renderPage({ sourceId: source.id, index: 0 }, source, STANDARD_LONG_SIDE / longSide, 0, null);
  }
  try {
    const ctx = getContext(canvas);
    const transparent = hasTransparency(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const blob = transparent
      ? await canvasToBlob(canvas, 'image/png')
      : await canvasToBlob(canvas, 'image/jpeg', settings.photoQuality === 'standard' ? 0.85 : 0.92);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return transparent ? out.embedPng(bytes) : out.embedJpg(bytes);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Builds one PDF from pages in board order. PDF pages are copied as they are (text stays selectable). */
async function buildPdf(pages: PdfPage[], onProgress: (ratio: number) => void): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const settings = usePdfSettingsStore.getState();
  const { sources } = usePdfStore.getState();
  const out = await PDFDocument.create();
  out.setProducer('CompressKit');
  out.setCreator('CompressKit (in-browser)');

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const source = sources[page.sourceId];
    if (source.kind === 'pdf') {
      const [copied] = await out.copyPages(getOpenPdf(source.id).edit, [page.index]);
      out.addPage(copied);
      if (page.rotation) copied.setRotation(degrees((copied.getRotation().angle + page.rotation) % 360));
    } else {
      const image = await embedPhoto(out, source, settings);
      const landscape =
        settings.orientation === 'landscape' || (settings.orientation === 'auto' && image.width > image.height);
      let pageWidth: number;
      let pageHeight: number;
      if (settings.pageSize === 'fit') {
        // Long side as tall as A4, so photo pages print and view at a familiar size.
        const scale = PAGE_SIZES.a4[1] / Math.max(image.width, image.height);
        pageWidth = image.width * scale + MARGINS[settings.margin] * 2;
        pageHeight = image.height * scale + MARGINS[settings.margin] * 2;
      } else {
        const [w, h] = PAGE_SIZES[settings.pageSize];
        [pageWidth, pageHeight] = landscape ? [h, w] : [w, h];
      }
      const pdfPage = out.addPage([pageWidth, pageHeight]);
      const margin = MARGINS[settings.margin];
      const fit = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
      const w = image.width * fit;
      const h = image.height * fit;
      pdfPage.drawImage(image, { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h });
      if (page.rotation) pdfPage.setRotation(degrees(page.rotation));
    }
    onProgress((i + 1) / pages.length);
    await tick();
  }
  return out.save();
}

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });

/** Runs an action with the busy state and a friendly notice on failure. */
async function run(label: string, action: (progress: (ratio: number) => void) => Promise<void>): Promise<void> {
  const store = usePdfStore.getState();
  if (store.busy) return;
  store.setBusy(label, 0);
  try {
    await action((ratio) => usePdfStore.getState().setBusy(label, ratio));
  } catch (e) {
    console.warn('[CompressKit] PDF action failed:', e);
    useUiStore.getState().pushNotice({
      tone: 'error',
      title: 'Something went wrong',
      message: 'The PDF could not be created. The file may be damaged, or too large for this browser.',
    });
  } finally {
    usePdfStore.getState().setBusy(null);
  }
}

export function savePdf(pages: PdfPage[]): Promise<void> {
  return run('Building PDF', async (progress) => {
    const bytes = await buildPdf(pages, progress);
    downloadBlob(pdfBlob(bytes), `${baseName(pages)}${pages.length === 1 ? '-page' : ''}.pdf`);
  });
}

/** Splits pages into PDFs of `every` pages each, downloaded together as a ZIP (or directly when there is one). */
export function splitPdf(pages: PdfPage[], every: number): Promise<void> {
  return run('Splitting PDF', async (progress) => {
    const size = Math.max(1, Math.floor(every));
    const base = baseName(pages);
    const pad = String(pages.length).length;
    const files: { name: string; blob: Blob }[] = [];
    for (let start = 0; start < pages.length; start += size) {
      const chunk = pages.slice(start, start + size);
      const bytes = await buildPdf(chunk, (r) => progress((start + r * chunk.length) / pages.length));
      const first = String(start + 1).padStart(pad, '0');
      const last = String(start + chunk.length).padStart(pad, '0');
      files.push({ name: `${base}-${chunk.length === 1 ? `page-${first}` : `pages-${first}-${last}`}.pdf`, blob: pdfBlob(bytes) });
    }
    if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
    else downloadBlob(await createZip(files), `${base}-split.zip`);
  });
}

/** Saves each page as a JPG or PNG at the chosen DPI. */
export function exportImages(pages: PdfPage[]): Promise<void> {
  return run('Saving pages as images', async (progress) => {
    const { imageFormat, imageDpi } = usePdfSettingsStore.getState();
    const { sources } = usePdfStore.getState();
    const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
    const ext = imageFormat === 'png' ? 'png' : 'jpg';
    const base = baseName(pages);
    const pad = Math.max(2, String(pages.length).length);
    const files: { name: string; blob: Blob }[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const source = sources[page.sourceId];
      // Photos export at their own resolution; PDF pages at the chosen DPI.
      const scale = source.kind === 'image' ? 1 : imageDpi / 72;
      const canvas = await renderPage(page, source, scale, page.rotation, imageFormat === 'jpeg' ? '#ffffff' : null);
      try {
        files.push({ name: `${base}-page-${String(i + 1).padStart(pad, '0')}.${ext}`, blob: await canvasToBlob(canvas, mime, 0.92) });
      } finally {
        releaseCanvas(canvas);
      }
      progress((i + 1) / pages.length);
      await tick();
    }
    if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
    else downloadBlob(await createZip(files), `${base}-images.zip`);
  });
}

/**
 * Parses "1-3, 7, 10-" into zero-based page indexes. Returns null when the text has something
 * that is not a page number or range, or a page beyond `count`.
 */
export function parsePageRanges(text: string, count: number): number[] | null {
  const result = new Set<number>();
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d+)?(?:(-)(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from;
    if (from < 1 || to > count || from > to) return null;
    for (let n = from; n <= to; n++) result.add(n - 1);
  }
  return [...result].sort((a, b) => a - b);
}
