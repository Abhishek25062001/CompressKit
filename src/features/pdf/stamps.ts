import type { PDFDocument, PDFFont, PDFImage, PDFPage } from '@cantoo/pdf-lib';
import type { NumberFormat, PageNumberSettings, SignatureAsset, SignaturePlacement, WatermarkSettings } from '../../types/pdf';
import { canvasToBlob, createCanvas, getContext } from '../image/canvas';

type Lib = typeof import('@cantoo/pdf-lib');

/**
 * A page as the reader sees it. PDF pages can carry a /Rotate that viewers apply on display, so
 * everything here is positioned in displayed coordinates (origin bottom-left, y up) and converted
 * back to the page's own, unrotated coordinates when drawn.
 */
interface View {
  width: number;
  height: number;
  /** Page rotation, clockwise, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  toPage: (x: number, y: number) => { x: number; y: number };
}

function viewOf(page: PDFPage): View {
  const box = page.getCropBox();
  const rotation = ((((page.getRotation().angle % 360) + 360) % 360) as View['rotation']);
  const { x: bx, y: by, width: w, height: h } = box;
  const toPage = (vx: number, vy: number) => {
    switch (rotation) {
      case 90:
        return { x: bx + w - vy, y: by + vx };
      case 180:
        return { x: bx + w - vx, y: by + h - vy };
      case 270:
        return { x: bx + vy, y: by + h - vx };
      default:
        return { x: bx + vx, y: by + vy };
    }
  };
  return rotation % 180 ? { width: h, height: w, rotation, toPage } : { width: w, height: h, rotation, toPage };
}

/**
 * Draws a box so it appears upright (turned by `angle` degrees counterclockwise) with its
 * bottom-left corner at a displayed point. Counter-rotating by the page's rotation cancels the
 * viewer's rotation.
 */
function drawBox(
  lib: Lib,
  view: View,
  corner: { x: number; y: number },
  angle: number,
  draw: (at: { x: number; y: number }, rotate: ReturnType<Lib['degrees']>) => void,
): void {
  draw(view.toPage(corner.x, corner.y), lib.degrees(angle + view.rotation));
}

function formatNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case 'n':
      return String(n);
    case 'page-n':
      return `Page ${n}`;
    case 'n-slash-total':
      return `${n} / ${total}`;
    default:
      return `Page ${n} of ${total}`;
  }
}

const EDGE = 24;
const NUMBER_SIZE = 10;

export function drawPageNumber(
  lib: Lib,
  page: PDFPage,
  font: PDFFont,
  settings: PageNumberSettings,
  index: number,
  count: number,
): void {
  if (settings.skipFirst && index === 0) return;
  const view = viewOf(page);
  const n = settings.start + index;
  const text = formatNumber(settings.format, n, settings.start + count - 1);
  const width = font.widthOfTextAtSize(text, NUMBER_SIZE);
  const [vertical, horizontal] = settings.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const x = horizontal === 'left' ? EDGE : horizontal === 'right' ? view.width - EDGE - width : (view.width - width) / 2;
  const y = vertical === 'top' ? view.height - EDGE - NUMBER_SIZE : EDGE;
  drawBox(lib, view, { x, y }, 0, (at, rotate) =>
    page.drawText(text, { x: at.x, y: at.y, size: NUMBER_SIZE, font, color: lib.rgb(0.25, 0.25, 0.28), rotate }),
  );
}

/**
 * Watermarks are drawn by the browser into a PNG, so any language and script works, and then
 * placed as an image. PDF standard fonts only cover Western European characters.
 */
export async function embedWatermark(
  doc: PDFDocument,
  settings: WatermarkSettings,
  logo: SignatureAsset | null,
): Promise<PDFImage | null> {
  if (settings.kind === 'logo') return logo ? doc.embedPng(new Uint8Array(await logo.blob.arrayBuffer())) : null;
  const text = settings.text.trim();
  if (!text) return null;
  const fontPx = 160;
  const font = `700 ${fontPx}px Inter, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
  const measure = getContext(createCanvas(1, 1));
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + fontPx;
  const canvas = createCanvas(width, Math.ceil(fontPx * 1.4));
  const ctx = getContext(canvas);
  ctx.font = font;
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  return doc.embedPng(png);
}

const WATERMARK_SPAN = { small: 0.35, medium: 0.55, large: 0.8 } as const;

export function drawWatermark(lib: Lib, page: PDFPage, image: PDFImage, settings: WatermarkSettings): void {
  const view = viewOf(page);
  const angle = settings.diagonal ? (Math.atan2(view.height, view.width) * 180) / Math.PI : 0;
  const rad = (angle * Math.PI) / 180;
  // Size along the line it runs on: the diagonal, or the width.
  const span = (settings.diagonal ? Math.hypot(view.width, view.height) : view.width) * WATERMARK_SPAN[settings.size];
  // A tall logo is limited by the page height instead, so it never runs off the page.
  const fit = Math.min(1, (view.height * 0.8) / ((span * image.height) / image.width));
  const w = span * fit;
  const h = ((span * image.height) / image.width) * fit;
  // Bottom-left corner that puts the rotated box's center on the page center.
  const cx = view.width / 2 - (Math.cos(rad) * w - Math.sin(rad) * h) / 2;
  const cy = view.height / 2 - (Math.sin(rad) * w + Math.cos(rad) * h) / 2;
  drawBox(lib, view, { x: cx, y: cy }, angle, (at, rotate) =>
    page.drawImage(image, { x: at.x, y: at.y, width: w, height: h, rotate, opacity: settings.opacity }),
  );
}

export function drawSignatures(
  lib: Lib,
  page: PDFPage,
  image: PDFImage,
  asset: SignatureAsset,
  placements: SignaturePlacement[],
): void {
  if (!placements.length) return;
  const view = viewOf(page);
  for (const p of placements) {
    const w = p.width * view.width;
    const h = (w * asset.height) / asset.width;
    const left = p.x * view.width;
    const bottom = view.height - p.y * view.height - h;
    drawBox(lib, view, { x: left, y: bottom }, 0, (at, rotate) =>
      page.drawImage(image, { x: at.x, y: at.y, width: w, height: h, rotate }),
    );
  }
}

/** Characters the standard PDF font can encode (Windows-1252); anything else is dropped from the hidden text. */
/** Punctuation outside Latin-1 that Windows-1252 still has: dashes, curly quotes, bullet, ellipsis, euro. */
const WIN_EXTRAS = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac].map((c) => String.fromCharCode(c)).join('');
const WIN_ANSI = new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF${WIN_EXTRAS}]`, 'g');

/**
 * Invisible, selectable text over each recognized word, which is how scanned PDFs become searchable.
 * Word boxes are in pixels of the page image as displayed; they are scaled to the page and placed
 * with the same rotation handling as the stamps, so the text lines up on rotated pages too.
 */
export function drawInvisibleText(
  lib: Lib,
  page: PDFPage,
  font: PDFFont,
  ocr: { width: number; height: number; words: { text: string; x0: number; y0: number; x1: number; y1: number }[] },
): number {
  const view = viewOf(page);
  const sx = view.width / ocr.width;
  const sy = view.height / ocr.height;
  let drawn = 0;
  for (const word of ocr.words) {
    const text = word.text.replace(WIN_ANSI, '');
    if (!text) continue;
    const boxW = (word.x1 - word.x0) * sx;
    const boxH = (word.y1 - word.y0) * sy;
    const unit = font.widthOfTextAtSize(text, 1);
    if (unit <= 0 || boxW <= 0 || boxH <= 0) continue;
    // Size the text so its width matches the word on the page, within reason of the word's height.
    const size = Math.min(boxH * 1.4, Math.max(boxH * 0.5, boxW / unit));
    const left = word.x0 * sx;
    const baseline = view.height - word.y1 * sy + boxH * 0.2;
    drawBox(lib, view, { x: left, y: baseline }, 0, (at, rotate) =>
      page.drawText(text, { x: at.x, y: at.y, size, font, rotate, opacity: 0 }),
    );
    drawn++;
  }
  return drawn;
}
