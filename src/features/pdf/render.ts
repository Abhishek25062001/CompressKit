import { canvasToBlob, createCanvas, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';
import { decodeImage } from '../image/decode';
import type { PdfPage, PdfSource, ScanSettings } from '../../types/pdf';
import { getOpenPdf } from './documents';
import { applyScan } from './scan';

/** Canvases above this many pixels fail in some browsers; renders are scaled down to stay under it. */
const MAX_RENDER_PIXELS = 40_000_000;

function capScale(width: number, height: number, scale: number): number {
  const pixels = width * scale * height * scale;
  return pixels > MAX_RENDER_PIXELS ? scale * Math.sqrt(MAX_RENDER_PIXELS / pixels) : scale;
}

/** Draws an image rotated clockwise by `rotation` degrees onto a new canvas of the rotated size. */
function drawRotated(image: ImageBitmap | AnyCanvas, rotation: number, width: number, height: number): AnyCanvas {
  const quarter = rotation === 90 || rotation === 270;
  const canvas = createCanvas(quarter ? height : width, quarter ? width : height);
  const ctx = getContext(canvas);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  return canvas;
}

/**
 * Renders a page to a canvas. `scale` is pixels per PDF point (1 = 72 DPI); photos use `scale` as a
 * fraction of their own pixels. `extraRotation` is applied on top of the page's own rotation.
 * Photo pages get their scan cleanup (straightening and look) before rotation.
 */
export async function renderPage(
  page: Pick<PdfPage, 'sourceId' | 'index'>,
  source: PdfSource,
  scale: number,
  extraRotation: number,
  background: string | null,
  scan?: ScanSettings,
): Promise<AnyCanvas> {
  if (source.kind === 'image') {
    const bitmap = await decodeImage(source.file);
    try {
      const s = Math.min(1, capScale(bitmap.width, bitmap.height, scale));
      if (scan && (scan.corners || scan.filter !== 'none')) {
        const cleaned = applyScan(bitmap, scan, Math.max(bitmap.width, bitmap.height) * s);
        const canvas = drawRotated(cleaned, extraRotation, cleaned.width, cleaned.height);
        releaseCanvas(cleaned);
        if (background) fillBehind(canvas, background);
        return canvas;
      }
      const width = Math.max(1, Math.round(bitmap.width * s));
      const height = Math.max(1, Math.round(bitmap.height * s));
      const canvas = drawRotated(bitmap, extraRotation, width, height);
      if (background) fillBehind(canvas, background);
      return canvas;
    } finally {
      bitmap.close();
    }
  }
  const pdfPage = await getOpenPdf(page.sourceId).view.getPage(page.index + 1);
  const rotation = (pdfPage.rotate + extraRotation) % 360;
  const base = pdfPage.getViewport({ scale: 1, rotation });
  const viewport = pdfPage.getViewport({ scale: capScale(base.width, base.height, scale), rotation });
  // pdf.js needs a DOM canvas on the main thread.
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await pdfPage.render({ canvas, viewport, background: background ?? undefined }).promise;
  pdfPage.cleanup();
  return canvas;
}

function fillBehind(canvas: AnyCanvas, color: string): void {
  const ctx = getContext(canvas);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

const THUMB_SIDE = 320;

/** A small WebP of the page without user rotation; the page grid rotates it with CSS. */
export async function renderThumbnail(page: PdfPage, source: PdfSource): Promise<string> {
  let scale: number;
  if (source.kind === 'image') {
    const bitmap = await decodeImage(source.file);
    scale = THUMB_SIDE / Math.max(bitmap.width, bitmap.height);
    if (page.scan && (page.scan.corners || page.scan.filter !== 'none')) {
      const cleaned = applyScan(bitmap, page.scan, THUMB_SIDE);
      bitmap.close();
      return toUrl(cleaned);
    }
    const canvas = drawRotated(bitmap, 0, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    bitmap.close();
    return toUrl(canvas);
  }
  const pdfPage = await getOpenPdf(page.sourceId).view.getPage(page.index + 1);
  const base = pdfPage.getViewport({ scale: 1 });
  scale = THUMB_SIDE / Math.max(base.width, base.height);
  pdfPage.cleanup();
  return toUrl(await renderPage(page, source, scale, 0, '#ffffff'));
}

async function toUrl(canvas: AnyCanvas): Promise<string> {
  try {
    return URL.createObjectURL(await canvasToBlob(canvas, 'image/webp', 0.8));
  } finally {
    releaseCanvas(canvas);
  }
}
