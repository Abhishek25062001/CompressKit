import type { PDFPage } from '@cantoo/pdf-lib';
import type { CropBox, PageRotation, PdfPage, PdfSource } from '../../types/pdf';
import { createCanvas, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';
export { cropCanvas } from '../image/canvas';
import { usePdfStore } from '../../store/pdfStore';
import { getOpenPdf } from './documents';
import { refreshThumbnail } from './intake';
import { renderPage } from './render';
import { viewOf } from './stamps';

/**
 * Cropping. A crop is kept as fractions of the page as it looks before the user turns it (its own
 * rotation applied, the rotate button's not), so turning a page afterwards keeps the same area.
 * PDF pages are cropped by moving their page boxes, like every PDF editor does: the text stays
 * real and selectable, and the part outside the box is hidden. Photo pages are cut before they
 * are placed on the page.
 */

export const FULL: CropBox = { x: 0, y: 0, width: 1, height: 1 };
const MIN = 0.02;

export function isCropped(crop: CropBox | undefined): crop is CropBox {
  return !!crop && (crop.x > 0.0005 || crop.y > 0.0005 || crop.width < 0.999 || crop.height < 0.999);
}

export function clampCrop(c: CropBox): CropBox {
  const width = Math.min(1, Math.max(MIN, c.width));
  const height = Math.min(1, Math.max(MIN, c.height));
  return { x: Math.min(1 - width, Math.max(0, c.x)), y: Math.min(1 - height, Math.max(0, c.y)), width, height };
}

/** The crop as it appears once the page is turned clockwise by `rotation`. */
export function toDisplayed(c: CropBox, rotation: PageRotation): CropBox {
  switch (rotation) {
    case 90:
      return { x: 1 - c.y - c.height, y: c.x, width: c.height, height: c.width };
    case 180:
      return { x: 1 - c.x - c.width, y: 1 - c.y - c.height, width: c.width, height: c.height };
    case 270:
      return { x: c.y, y: 1 - c.x - c.width, width: c.height, height: c.width };
    default:
      return c;
  }
}

/** The reverse of toDisplayed: a box drawn on the turned page, back in the page's own frame. */
export function fromDisplayed(c: CropBox, rotation: PageRotation): CropBox {
  switch (rotation) {
    case 90:
      return toDisplayed(c, 270);
    case 270:
      return toDisplayed(c, 90);
    default:
      return toDisplayed(c, rotation);
  }
}

/**
 * Moves a PDF page's boxes to the crop. `displayed` is in fractions of the page as it is shown
 * (after all rotation), top-left origin. Media, crop, bleed, trim and art boxes all match, so
 * viewers, printers and other tools agree on the page's size.
 */
export function applyCropBox(page: PDFPage, displayed: CropBox): void {
  const view = viewOf(page);
  const left = displayed.x * view.width;
  const right = (displayed.x + displayed.width) * view.width;
  const top = view.height - displayed.y * view.height;
  const bottom = view.height - (displayed.y + displayed.height) * view.height;
  const a = view.toPage(left, bottom);
  const b = view.toPage(right, top);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  page.setMediaBox(x, y, width, height);
  page.setCropBox(x, y, width, height);
  page.setBleedBox(x, y, width, height);
  page.setTrimBox(x, y, width, height);
  page.setArtBox(x, y, width, height);
}


/** Pixels darker than this (0–255) count as content when finding margins. */
const INK = 232;

/**
 * The smallest box holding everything that is not blank paper on a rendered page, in fractions of
 * the canvas. A row or column counts only with a few dark pixels in it, so specks of scanner dust
 * do not stop the margins from being found. Null for an empty page.
 */
export function contentBounds(canvas: AnyCanvas): CropBox | null {
  const { width, height } = canvas;
  const data = getContext(canvas).getImageData(0, 0, width, height).data;
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 16) continue;
      const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (luma < INK) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const rowMin = Math.max(1, Math.round(width * 0.002));
  const colMin = Math.max(1, Math.round(height * 0.002));
  let top = 0;
  while (top < height && rows[top] < rowMin) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && rows[bottom] < rowMin) bottom--;
  let left = 0;
  while (left < width && cols[left] < colMin) left++;
  let right = width - 1;
  while (right > left && cols[right] < colMin) right--;
  return { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

/** Long side of the render used to find margins: plenty for a margin, and quick. */
const DETECT_SIDE = 900;

/**
 * Finds a page's white margins and returns a crop that removes them, leaving `padding` points of
 * space around the content. Null when the page is blank.
 */
export async function detectMargins(page: PdfPage, source: PdfSource, padding: number): Promise<CropBox | null> {
  let widthPt: number;
  let heightPt: number;
  let scale: number;
  if (source.kind === 'pdf') {
    const pdfPage = await getOpenPdf(page.sourceId).view.getPage(page.index + 1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    widthPt = viewport.width;
    heightPt = viewport.height;
    pdfPage.cleanup();
    scale = DETECT_SIDE / Math.max(widthPt, heightPt);
  } else {
    scale = 1;
    widthPt = 0;
    heightPt = 0;
  }
  // Rendered in the page's own frame (no user rotation), which is where crops are kept.
  let canvas = await renderPage(page, source, scale, 0, '#ffffff', page.scan);
  if (source.kind === 'image') {
    // Photos: measure at a manageable size; a photo's "points" are its pixels.
    widthPt = canvas.width;
    heightPt = canvas.height;
    const s = Math.min(1, DETECT_SIDE / Math.max(canvas.width, canvas.height));
    if (s < 1) {
      const small = createCanvas(Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
      getContext(small).drawImage(canvas, 0, 0, small.width, small.height);
      releaseCanvas(canvas);
      canvas = small;
    }
  }
  try {
    const bounds = contentBounds(canvas);
    if (!bounds) return null;
    const px = padding / widthPt;
    const py = padding / heightPt;
    const left = Math.max(0, bounds.x - px);
    const top = Math.max(0, bounds.y - py);
    const right = Math.min(1, bounds.x + bounds.width + px);
    const bottom = Math.min(1, bounds.y + bounds.height + py);
    return clampCrop({ x: left, y: top, width: right - left, height: bottom - top });
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Removes the white margins of many pages at once, each page measured on its own. Blank pages
 * are left whole. Returns how many pages were cropped.
 */
export async function autoCropPages(pages: PdfPage[], padding: number): Promise<number> {
  const store = usePdfStore.getState();
  if (store.busy) return 0;
  let cropped = 0;
  try {
    for (let i = 0; i < pages.length; i++) {
      store.setBusy(`Finding margins on page ${i + 1} of ${pages.length}`, i / pages.length);
      const page = pages[i];
      const source = usePdfStore.getState().sources[page.sourceId];
      if (!source) continue;
      const crop = await detectMargins(page, source, padding);
      if (!crop || !isCropped(crop)) continue;
      usePdfStore.getState().updatePage(page.id, { crop });
      refreshThumbnail(page.id);
      cropped++;
    }
  } finally {
    usePdfStore.getState().setBusy(null);
  }
  return cropped;
}
