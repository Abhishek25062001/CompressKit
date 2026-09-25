import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, PdfSettings, PdfSource } from '../../types/pdf';
import { downloadBlob } from '../../utils/download';
import { sanitizeBaseName } from '../../utils/filename';
import { createZip } from '../../utils/zip';
import { canvasToBlob, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';
import { hasTransparency } from '../image/resize';
import { formatBytes, formatPercent, savedRatio } from '../../utils/format';
import { compressPdfBytes } from './compress';
import { getOpenPdf } from './documents';
import { renderPage } from './render';
import { filledCopy, FormFillError } from './forms';
import { hasTextLayer, recognizePage, type OcrPage } from './ocr';
import { coversContent, createEditCache, drawEdits, flattenPages } from './edits';
import { drawInvisibleText, drawPageNumber, drawSignatures, drawWatermark, embedWatermark } from './stamps';

/** Page sizes in PDF points (1/72 inch). */
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MARGINS = { none: 0, small: 18, large: 36 } as const;
/** "Standard" photo quality: about 200 DPI across an A4 page, plenty for reading and printing documents. */
const STANDARD_LONG_SIDE = 2339;

type LibDocument = import('@cantoo/pdf-lib').PDFDocument;

/** Base name for downloads: the file's own name when everything came from one file. */
function baseName(pages: PdfPage[]): string {
  const { sources } = usePdfStore.getState();
  const ids = new Set(pages.map((p) => p.sourceId));
  if (ids.size === 1) return sanitizeBaseName(sources[[...ids][0]].name);
  return `compresskit-${new Date().toISOString().slice(0, 10)}`;
}

/** Yields to the browser so progress can paint during long synchronous PDF work. */
const tick = () => new Promise((r) => setTimeout(r, 0));

async function embedPhoto(out: LibDocument, page: PdfPage, source: PdfSource, settings: PdfSettings) {
  // Decoding applies EXIF orientation, which PDF viewers would otherwise ignore for phone photos.
  const probe = await renderPage(page, source, 1, 0, null, page.scan);
  const longSide = Math.max(probe.width, probe.height);
  let canvas: AnyCanvas = probe;
  if (settings.photoQuality === 'standard' && longSide > STANDARD_LONG_SIDE) {
    releaseCanvas(probe);
    canvas = await renderPage(page, source, STANDARD_LONG_SIDE / longSide, 0, null, page.scan);
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

/**
 * Adds edits, page numbers, the watermark and placed signatures. They go on top of each page after
 * it is built, so they sit above photos and PDF content alike. Numbering counts pages in this file.
 */
async function applyStamps(lib: typeof import('@cantoo/pdf-lib'), out: LibDocument, pages: PdfPage[], settings: PdfSettings): Promise<void> {
  const { signature, watermarkLogo, editImages } = usePdfStore.getState();
  const outPages = out.getPages();
  // Edits become part of the page, under the watermark, signatures and numbers.
  const cache = createEditCache();
  for (let i = 0; i < outPages.length; i++) {
    const edits = pages[i].edits;
    if (edits?.length) await drawEdits(lib, out, outPages[i], edits, editImages, cache);
  }
  const signed = signature && pages.some((p) => p.signatures.length);
  if (!settings.pageNumbers.enabled && !settings.watermark.enabled && !signed) return;
  const font = settings.pageNumbers.enabled ? await out.embedFont(lib.StandardFonts.Helvetica) : null;
  const watermark = settings.watermark.enabled ? await embedWatermark(out, settings.watermark, watermarkLogo) : null;
  const signatureImage = signed ? await out.embedPng(new Uint8Array(await signature.blob.arrayBuffer())) : null;
  outPages.forEach((page, i) => {
    if (watermark) drawWatermark(lib, page, watermark, settings.watermark);
    if (signatureImage && signature) drawSignatures(lib, page, signatureImage, signature, pages[i].signatures);
    if (font) drawPageNumber(lib, page, font, settings.pageNumbers, i, outPages.length);
  });
}

/** Builds one PDF from pages in board order. PDF pages are copied as they are (text stays selectable). */
export interface ProtectOptions {
  /** Needed to open the file. */
  password: string;
  allowPrinting: boolean;
  allowCopying: boolean;
}

/** A random owner password: without one, readers could lift the printing and copying limits. */
function randomOwnerPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Optional extras for one build: a password, and recognized text to lay invisibly over pages. */
interface BuildExtras {
  protect?: ProtectOptions;
  /** Recognized text per page id, from OCR. */
  ocr?: Map<string, OcrPage>;
}

/** Annotation types kept when comments are removed: links, and form widgets, which draw the fields' current values. */
const KEPT_ANNOTATIONS = new Set(['Link', 'Widget']);

/**
 * Removes what a copied page could still carry from its old file: page-level metadata, editing
 * history, scripts that run on open, and, when asked, comments and markup.
 */
function cleanPage(lib: typeof import('@cantoo/pdf-lib'), page: import('@cantoo/pdf-lib').PDFPage, removeComments: boolean): void {
  const { PDFName, PDFArray, PDFDict } = lib;
  const node = page.node;
  for (const key of ['Metadata', 'PieceInfo', 'AA', 'LastModified']) node.delete(PDFName.of(key));
  if (!removeComments) return;
  const annots = node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  const kept = lib.PDFArray.withContext(page.doc.context);
  for (let i = 0; i < annots.size(); i++) {
    const subtype = annots.lookupMaybe(i, PDFDict)?.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '';
    if (KEPT_ANNOTATIONS.has(subtype)) kept.push(annots.get(i));
  }
  node.set(PDFName.of('Annots'), kept);
}

async function buildPdf(pages: PdfPage[], onProgress: (ratio: number) => void, extras: BuildExtras = {}): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFDocument, degrees } = lib;
  const settings = usePdfSettingsStore.getState();
  const { sources, formValues, docInfo } = usePdfStore.getState();
  const out = await PDFDocument.create();
  // A new document: nothing from the original files' properties is carried over.
  out.setProducer('CompressKit');
  out.setCreator('CompressKit (in-browser)');
  if (docInfo.title.trim()) out.setTitle(docInfo.title.trim());
  if (docInfo.author.trim()) out.setAuthor(docInfo.author.trim());

  // Copy each source's pages in one call: pages of one PDF usually share fonts and images, and
  // pdf-lib copies shared objects once per call. Copying page by page duplicated them.
  const copies = new Map<string, import('@cantoo/pdf-lib').PDFPage>();
  const bySource = new Map<string, number[]>();
  for (const page of pages) {
    if (sources[page.sourceId].kind !== 'pdf') continue;
    bySource.set(page.sourceId, [...(bySource.get(page.sourceId) ?? []), page.index]);
  }
  for (const [sourceId, indexes] of bySource) {
    // A PDF with typed-in form answers is copied from a filled, flattened copy.
    const answers = formValues[sourceId];
    const from = answers && Object.keys(answers).length ? await filledCopy(sourceId, answers) : getOpenPdf(sourceId).edit;
    const copied = await out.copyPages(from, indexes);
    indexes.forEach((index, i) => copies.set(`${sourceId}:${index}`, copied[i]));
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const source = sources[page.sourceId];
    if (source.kind === 'pdf') {
      const copied = copies.get(`${source.id}:${page.index}`)!;
      out.addPage(copied);
      cleanPage(lib, copied, settings.removeComments);
      if (page.rotation) copied.setRotation(degrees((copied.getRotation().angle + page.rotation) % 360));
    } else {
      const image = await embedPhoto(out, page, source, settings);
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
  await applyStamps(lib, out, pages, settings);
  if (extras.ocr?.size) {
    const font = await out.embedFont(lib.StandardFonts.Helvetica);
    out.getPages().forEach((pdfPage, i) => {
      const words = extras.ocr!.get(pages[i].id);
      if (words) drawInvisibleText(lib, pdfPage, font, words);
    });
  }
  // Pages whose edits cover content are turned into pictures when asked, so what was covered is gone.
  const covered = settings.flattenCovered ? pages.flatMap((p, i) => (coversContent(p.edits) ? [i] : [])) : [];
  const final = covered.length ? await flattenPages(await out.save(), covered) : out;
  if (extras.protect) {
    const { protect } = extras;
    // AES-256, which every current PDF reader opens.
    final.encrypt({
      userPassword: protect.password,
      ownerPassword: randomOwnerPassword(),
      permissions: {
        printing: protect.allowPrinting ? 'highResolution' : false,
        copying: protect.allowCopying,
        modifying: false,
        annotating: false,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });
  }
  return final.save({ useObjectStreams: true });
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
    useUiStore.getState().pushNotice(
      e instanceof FormFillError
        ? {
            tone: 'error',
            title: "A form answer couldn't be added",
            message: `${e.field ? `Field "${e.field}": ` : ''}the standard PDF font covers Latin letters, numbers and common symbols only.`,
          }
        : {
            tone: 'error',
            title: 'Something went wrong',
            message: 'The PDF could not be created. The file may be damaged, or too large for this browser.',
          },
    );
  } finally {
    usePdfStore.getState().setBusy(null);
  }
}

export function savePdf(pages: PdfPage[], protect?: ProtectOptions): Promise<void> {
  return run(protect ? 'Protecting PDF' : 'Building PDF', async (progress) => {
    const bytes = await buildPdf(pages, progress, { protect });
    downloadBlob(pdfBlob(bytes), `${baseName(pages)}${pages.length === 1 ? '-page' : ''}${protect ? '-protected' : ''}.pdf`);
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
      const canvas = await renderPage(page, source, scale, page.rotation, imageFormat === 'jpeg' ? '#ffffff' : null, page.scan);
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
 * Builds the PDF, then shrinks it: photos inside are recompressed, and with a size target the level
 * steps up (and, when allowed, pages are flattened) until the file fits.
 */
export function compressPdf(pages: PdfPage[]): Promise<void> {
  return run('Compressing PDF', async (progress) => {
    const settings = usePdfSettingsStore.getState();
    const built = await buildPdf(pages, (r) => progress(r * 0.3));
    const target = settings.compressTargetKB ? settings.compressTargetKB * 1024 : null;
    const result = await compressPdfBytes(
      built,
      { level: settings.compressLevel, targetBytes: target, allowFlatten: settings.allowFlatten },
      (r, stage) => usePdfStore.getState().setBusy(stage, 0.3 + r * 0.7),
    );
    downloadBlob(pdfBlob(result.bytes), `${baseName(pages)}-compressed.pdf`);

    const before = built.length;
    const after = result.bytes.length;
    const change = `${formatBytes(before)} → ${formatBytes(after)}${after < before ? ` (${formatPercent(savedRatio(before, after))} smaller)` : ''}`;
    const notice = useUiStore.getState().pushNotice;
    if (target && after > target) {
      notice({
        tone: 'warning',
        title: `Couldn't get under ${formatBytes(target)}`,
        message: settings.allowFlatten
          ? `${change}. This is the smallest it could go. Try fewer pages, or split the file.`
          : `${change}. Turn on "Flatten pages if needed" to go smaller; text then stops being selectable.`,
      });
    } else if (result.method === 'unchanged') {
      notice({
        tone: 'info',
        title: 'Already compact',
        message: `${change}. There were no large photos to shrink; text and drawings are already small.`,
      });
    } else {
      notice({
        tone: 'info',
        title: 'PDF compressed',
        message:
          result.method === 'flattened'
            ? `${change}. Pages were turned into images, so text is no longer selectable.`
            : `${change}. ${result.photos} photo${result.photos === 1 ? '' : 's'} recompressed; text stays selectable.`,
      });
    }
  });
}

/**
 * Reads the text on each page with OCR and saves a PDF where that text is selectable and searchable,
 * hidden behind the page image. Pages that already have real text are left as they are.
 */
export function ocrPdf(pages: PdfPage[], options: { alsoText: boolean }): Promise<void> {
  return run('Reading text', async (progress) => {
    const { sources } = usePdfStore.getState();
    const results = new Map<string, OcrPage>();
    const texts: string[] = [];
    let skipped = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const source = sources[page.sourceId];
      const label = `Reading text on page ${i + 1} of ${pages.length}`;
      usePdfStore.getState().setBusy(label, (i / pages.length) * 0.9);
      if (await hasTextLayer(page, source)) {
        skipped++;
        continue;
      }
      const result = await recognizePage(page, source, (r, stage) =>
        usePdfStore.getState().setBusy(stage === 'Reading text' ? label : stage, ((i + r) / pages.length) * 0.9),
      );
      results.set(page.id, result);
      texts.push(`--- Page ${i + 1} ---\n${result.text.trim()}`);
    }
    usePdfStore.getState().setBusy('Saving searchable PDF', 0.9);
    const bytes = await buildPdf(pages, (r) => progress(0.9 + r * 0.1), { ocr: results });
    const base = baseName(pages);
    downloadBlob(pdfBlob(bytes), `${base}-searchable.pdf`);
    if (options.alsoText && texts.length) {
      downloadBlob(new Blob([texts.join('\n\n')], { type: 'text/plain;charset=utf-8' }), `${base}-text.txt`);
    }

    const words = [...results.values()].reduce((n, r) => n + r.words.length, 0);
    const notice = useUiStore.getState().pushNotice;
    if (!results.size) {
      notice({ tone: 'info', title: 'Already searchable', message: 'Every page already has selectable text, so nothing needed reading.' });
    } else if (!words) {
      notice({ tone: 'warning', title: 'No text found', message: 'Try a sharper, well-lit photo, or Black & white under Scan.' });
    } else {
      notice({
        tone: 'info',
        title: 'Text recognized',
        message: `${words} words on ${results.size} page${results.size === 1 ? '' : 's'}${skipped ? `; ${skipped} already had text` : ''}. You can now search and copy text in the PDF.`,
      });
    }
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
