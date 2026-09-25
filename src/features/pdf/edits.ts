import type { PDFDocument, PDFFont, PDFImage, PDFPage } from '@cantoo/pdf-lib';
import type { PageEdit, SignatureAsset } from '../../types/pdf';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';
import { loadPdfjs } from './documents';
import { drawBox, viewOf } from './stamps';

type Lib = typeof import('@cantoo/pdf-lib');
type TextEdit = Extract<PageEdit, { kind: 'text' }>;

/** Line height of edit text, as a multiple of its size. The editor uses the same value. */
export const EDIT_LINE_HEIGHT = 1.25;

const STANDARD = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
} as const;

/** CSS fonts that match the PDF standard fonts' widths closely, so text wraps the same in the editor. */
export const EDIT_CSS_FONT = {
  sans: 'Helvetica, Arial, "Noto Sans", "Nirmala UI", sans-serif',
  serif: '"Times New Roman", Times, "Noto Serif", "Nirmala UI", serif',
  mono: '"Courier New", Courier, monospace',
} as const;

function rgbOf(lib: Lib, hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Breaks text into lines that fit `width`, measuring with `measure`. Newlines always break. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      if (!w) continue;
      const next = line + w;
      if (line && measure(next.trimEnd()) > width && /\S/.test(w)) {
        lines.push(line.trimEnd());
        line = w;
      } else line = next;
      // A single word wider than the box is cut by characters.
      while (measure(line) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

interface Cache {
  fonts: Map<string, PDFFont>;
  images: Map<string, PDFImage>;
  charset: Set<number> | null;
}

function fontFor(doc: PDFDocument, cache: Cache, edit: TextEdit): PDFFont {
  const name = STANDARD[edit.font][(edit.bold ? 1 : 0) + (edit.italic ? 2 : 0)];
  let font = cache.fonts.get(name);
  if (!font) {
    font = doc.embedStandardFont(name as Parameters<PDFDocument['embedStandardFont']>[0]);
    cache.fonts.set(name, font);
  }
  return font;
}

/** Text in scripts the standard fonts lack is drawn by the browser into a picture of the box. */
async function rasterText(edit: TextEdit, lines: string[], width: number, size: number): Promise<Uint8Array> {
  const scale = 4;
  const lineHeight = size * EDIT_LINE_HEIGHT;
  const canvas = createCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(lines.length * lineHeight * scale)));
  const ctx = getContext(canvas);
  ctx.font = `${edit.italic ? 'italic ' : ''}${edit.bold ? '700' : '400'} ${size * scale}px ${EDIT_CSS_FONT[edit.font]}`;
  ctx.fillStyle = edit.color;
  ctx.textAlign = edit.align;
  ctx.textBaseline = 'alphabetic';
  const x = edit.align === 'left' ? 0 : edit.align === 'center' ? canvas.width / 2 : canvas.width;
  lines.forEach((line, i) => ctx.fillText(line, x, (i * lineHeight + size * 0.97) * scale));
  const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  releaseCanvas(canvas);
  return png;
}

async function drawText(lib: Lib, doc: PDFDocument, page: PDFPage, edit: TextEdit, cache: Cache): Promise<void> {
  const view = viewOf(page);
  const font = fontFor(doc, cache, edit);
  const size = edit.size * view.height;
  const width = edit.width * view.width;
  const left = edit.x * view.width;
  const top = edit.y * view.height;
  cache.charset ??= new Set(font.getCharacterSet());
  const encodable = [...edit.text.replace(/\n/g, '')].every((ch) => cache.charset!.has(ch.codePointAt(0)!));
  const measure = encodable
    ? (s: string) => font.widthOfTextAtSize(s, size)
    : (() => {
        const ctx = getContext(createCanvas(1, 1));
        ctx.font = `${edit.italic ? 'italic ' : ''}${edit.bold ? '700' : '400'} ${size}px ${EDIT_CSS_FONT[edit.font]}`;
        return (s: string) => ctx.measureText(s).width;
      })();
  const lines = wrapText(edit.text, width, measure);
  const lineHeight = size * EDIT_LINE_HEIGHT;
  const textHeight = lines.length * lineHeight;

  if (edit.background) {
    const h = Math.max(textHeight, (edit.coverHeight ?? 0) * view.height);
    drawBox(lib, view, { x: left, y: view.height - top - h }, 0, (at, rotate) =>
      page.drawRectangle({ x: at.x, y: at.y, width, height: h, rotate, color: rgbOf(lib, edit.background!) }),
    );
  }

  if (!encodable) {
    const png = await doc.embedPng(await rasterText(edit, lines, width, size));
    drawBox(lib, view, { x: left, y: view.height - top - textHeight }, 0, (at, rotate) =>
      page.drawImage(png, { x: at.x, y: at.y, width, height: textHeight, rotate }),
    );
    return;
  }
  lines.forEach((line, i) => {
    if (!line) return;
    const w = font.widthOfTextAtSize(line, size);
    const dx = edit.align === 'center' ? (width - w) / 2 : edit.align === 'right' ? width - w : 0;
    // Baseline sits where the browser puts it in the editor: about 0.97 of the size below the line top
    // for a 1.25 line height (half the extra space above, then the ascent).
    const baseline = top + i * lineHeight + size * 0.97;
    drawBox(lib, view, { x: left + dx, y: view.height - baseline }, 0, (at, rotate) =>
      page.drawText(line, { x: at.x, y: at.y, size, font, rotate, color: rgbOf(lib, edit.color) }),
    );
  });
}

async function embedAsset(doc: PDFDocument, cache: Cache, id: string, asset: SignatureAsset): Promise<PDFImage> {
  let image = cache.images.get(id);
  if (!image) {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    image = asset.blob.type === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    cache.images.set(id, image);
  }
  return image;
}

export function createEditCache(): Cache {
  return { fonts: new Map(), images: new Map(), charset: null };
}

/** Draws a page's edits in the order they were made, so later edits sit on top. */
export async function drawEdits(
  lib: Lib,
  doc: PDFDocument,
  page: PDFPage,
  edits: PageEdit[],
  images: Record<string, SignatureAsset>,
  cache: Cache,
): Promise<void> {
  const view = viewOf(page);
  for (const edit of edits) {
    if (edit.kind === 'text') {
      if (edit.text.trim() || edit.background) await drawText(lib, doc, page, edit, cache);
    } else if (edit.kind === 'draw') {
      const thickness = edit.thickness * view.width;
      const color = rgbOf(lib, edit.color);
      for (const stroke of edit.strokes) {
        const points = stroke.map(([x, y]) => view.toPage(x * view.width, view.height - y * view.height));
        if (points.length === 1) {
          page.drawCircle({ x: points[0].x, y: points[0].y, size: thickness / 2, color });
          continue;
        }
        for (let i = 1; i < points.length; i++) {
          page.drawLine({ start: points[i - 1], end: points[i], thickness, color, lineCap: lib.LineCapStyle.Round });
        }
      }
    } else if (edit.kind === 'image') {
      const asset = images[edit.imageId];
      if (!asset) continue;
      const image = await embedAsset(doc, cache, edit.imageId, asset);
      const w = edit.width * view.width;
      const h = edit.height * view.height;
      drawBox(lib, view, { x: edit.x * view.width, y: view.height - edit.y * view.height - h }, 0, (at, rotate) =>
        page.drawImage(image, { x: at.x, y: at.y, width: w, height: h, rotate }),
      );
    } else {
      const w = edit.width * view.width;
      const h = edit.height * view.height;
      const color = rgbOf(lib, edit.color);
      drawBox(lib, view, { x: edit.x * view.width, y: view.height - edit.y * view.height - h }, 0, (at, rotate) => {
        if (edit.kind === 'box') page.drawRectangle({ x: at.x, y: at.y, width: w, height: h, rotate, borderColor: color, borderWidth: 1.5 });
        else if (edit.kind === 'highlight')
          page.drawRectangle({ x: at.x, y: at.y, width: w, height: h, rotate, color, opacity: 0.4, blendMode: lib.BlendMode.Multiply });
        else page.drawRectangle({ x: at.x, y: at.y, width: w, height: h, rotate, color });
      });
    }
  }
}

/** True when an edit hides what is under it: white-out, or text retyped over the original. */
export function coversContent(edits: PageEdit[] | undefined): boolean {
  return !!edits?.some((e) => e.kind === 'whiteout' || (e.kind === 'text' && !!e.background));
}

/**
 * White-out only hides what is under it: the original text is still in the file, and can be copied
 * or found by search. Turning a page into a picture removes it for good. Only the given pages are
 * flattened, at 200 DPI; every other page keeps its real text.
 */
export async function flattenPages(bytes: Uint8Array, indexes: number[]): Promise<PDFDocument> {
  const [{ PDFDocument }, pdfjs] = await Promise.all([import('@cantoo/pdf-lib'), loadPdfjs()]);
  const view = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  try {
    for (const index of indexes) {
      const page = await view.getPage(index + 1);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 200 / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
      releaseCanvas(canvas);
      page.cleanup();
      const image = await doc.embedJpg(jpeg);
      const flat = doc.insertPage(index, [size.width, size.height]);
      flat.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
      doc.removePage(index + 1);
    }
  } finally {
    void view.loadingTask.destroy();
  }
  return doc;
}
