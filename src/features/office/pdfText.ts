import type { PDFDocument, PDFFont, PDFImage, PDFPage } from '@cantoo/pdf-lib';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';

/**
 * Draws text on PDF pages for the Excel and PowerPoint converters. Text uses the fonts every PDF
 * reader has built in, so it stays sharp, selectable and searchable. Those fonts only cover
 * Western European letters; stretches in other scripts (Hindi, Arabic, Chinese, ₹, emoji…) are
 * drawn by the browser, which knows every script, and placed as small pictures in the line.
 */

type Lib = typeof import('@cantoo/pdf-lib');

export type Family = 'sans' | 'serif' | 'mono';

export interface TextStyle {
  family: Family;
  bold: boolean;
  italic: boolean;
  /** Points. */
  size: number;
  /** "#rrggbb". */
  color: string;
  underline?: boolean;
  strike?: boolean;
}

const STANDARD: Record<Family, [string, string, string, string]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};
const CSS_FAMILY: Record<Family, string> = {
  sans: 'Arial, Helvetica, "Noto Sans", "Nirmala UI", "Segoe UI", system-ui, sans-serif',
  serif: '"Times New Roman", Times, "Noto Serif", "Nirmala UI", serif',
  mono: '"Courier New", Courier, "Noto Sans Mono", monospace',
};

/** A font name from Office, reduced to one of the three families PDF readers have built in. */
export function familyOf(name: string | undefined): Family {
  const n = (name ?? '').toLowerCase();
  if (/mono|courier|consol|menlo|lucida console/.test(n)) return 'mono';
  if (/times|georgia|garamond|cambria|palatino|book antiqua|constantia|serif/.test(n) && !/sans/.test(n)) return 'serif';
  return 'sans';
}

export function rgbOf(lib: Lib, hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Segment {
  text: string;
  raster: boolean;
  width: number;
}

export class PdfTextPainter {
  private fonts = new Map<string, PDFFont>();
  private charset: Set<number> | null = null;
  private rasters = new Map<string, PDFImage>();
  private measureCtx = getContext(createCanvas(1, 1));
  /** Characters drawn as pictures because the built-in fonts lack them. */
  rasterized = 0;
  private lib: Lib;
  private doc: PDFDocument;

  constructor(lib: Lib, doc: PDFDocument) {
    this.lib = lib;
    this.doc = doc;
  }

  font(st: Pick<TextStyle, 'family' | 'bold' | 'italic'>): PDFFont {
    const name = STANDARD[st.family][(st.bold ? 1 : 0) + (st.italic ? 2 : 0)];
    let f = this.fonts.get(name);
    if (!f) {
      f = this.doc.embedStandardFont(name as Parameters<PDFDocument['embedStandardFont']>[0]);
      this.fonts.set(name, f);
    }
    return f;
  }

  private encodable(ch: string): boolean {
    this.charset ??= new Set(this.font({ family: 'sans', bold: false, italic: false }).getCharacterSet());
    return this.charset.has(ch.codePointAt(0)!);
  }

  private cssFont(st: TextStyle, px: number): string {
    return `${st.italic ? 'italic ' : ''}${st.bold ? '700' : '400'} ${px}px ${CSS_FAMILY[st.family]}`;
  }

  private segments(text: string, st: TextStyle): Segment[] {
    const segs: Segment[] = [];
    for (const ch of text) {
      const raster = !this.encodable(ch);
      const last = segs[segs.length - 1];
      if (last && last.raster === raster) last.text += ch;
      else segs.push({ text: ch, raster, width: 0 });
    }
    for (const s of segs) {
      if (s.raster) {
        this.measureCtx.font = this.cssFont(st, st.size);
        s.width = this.measureCtx.measureText(s.text).width;
      } else s.width = this.font(st).widthOfTextAtSize(s.text, st.size);
    }
    return segs;
  }

  measure(text: string, st: TextStyle): number {
    return this.segments(text, st).reduce((w, s) => w + s.width, 0);
  }

  /** Breaks text into lines no wider than `width`, at spaces where possible and inside long words when not. */
  wrap(text: string, width: number, st: TextStyle): string[] {
    const out: string[] = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      const words = paragraph.split(/(\s+)/).filter((w) => w !== '');
      let line = '';
      for (const word of words) {
        const next = line + word;
        if (!line || this.measure(next.trimEnd(), st) <= width) {
          line = next;
          continue;
        }
        out.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
        // A word longer than the line is cut where it no longer fits.
        while (line && this.measure(line, st) > width) {
          let cut = line.length - 1;
          while (cut > 1 && this.measure(line.slice(0, cut), st) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  private async rasterImage(text: string, st: TextStyle, width: number): Promise<PDFImage> {
    const key = `${this.cssFont(st, st.size)}|${st.color}|${text}`;
    const cached = this.rasters.get(key);
    if (cached) return cached;
    const scale = 4;
    const canvas = createCanvas(Math.max(1, Math.ceil(width * scale) + 2), Math.ceil(st.size * 1.3 * scale));
    const ctx = getContext(canvas);
    ctx.font = this.cssFont(st, st.size * scale);
    ctx.fillStyle = st.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 0, st.size * 1.0 * scale);
    const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    releaseCanvas(canvas);
    const image = await this.doc.embedPng(png);
    this.rasters.set(key, image);
    this.rasterized += [...text].length;
    return image;
  }

  /** Draws one line of text with its baseline at (x, y) in PDF coordinates (y up). Returns its width. */
  async draw(page: PDFPage, text: string, x: number, y: number, st: TextStyle): Promise<number> {
    const color = rgbOf(this.lib, st.color);
    let cx = x;
    for (const seg of this.segments(text, st)) {
      if (seg.raster) {
        const image = await this.rasterImage(seg.text, st, seg.width);
        const h = st.size * 1.3;
        page.drawImage(image, { x: cx, y: y - st.size * 0.3, width: image.width / 4, height: h });
      } else {
        page.drawText(seg.text, { x: cx, y, size: st.size, font: this.font(st), color });
      }
      cx += seg.width;
    }
    const width = cx - x;
    const thickness = Math.max(0.5, st.size / 18);
    if (st.underline) page.drawLine({ start: { x, y: y - st.size * 0.12 }, end: { x: x + width, y: y - st.size * 0.12 }, thickness, color });
    if (st.strike) page.drawLine({ start: { x, y: y + st.size * 0.3 }, end: { x: x + width, y: y + st.size * 0.3 }, thickness, color });
    return width;
  }
}
