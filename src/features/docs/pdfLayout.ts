import type { PDFDocument, PDFFont, PDFImage, PDFPage } from '@cantoo/pdf-lib';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';
import { STYLE_METRICS, type Align, type DocModel, type FontFamily, type ImageRun, type Paragraph, type Run, type Table } from './model';

/**
 * Lays out the shared document model as PDF pages: lines are broken to the page width, paragraphs
 * flow onto new pages, and tables, lists and pictures are drawn in place. Text uses the fonts every
 * PDF reader has built in, so it stays sharp, selectable and searchable. Those fonts only cover
 * Western European letters; words in other scripts (Hindi, Arabic, Chinese, emoji…) are drawn by
 * the browser, which knows every script, and placed as small pictures in the line.
 */

type Lib = typeof import('@cantoo/pdf-lib');

interface Style {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  size: number;
  color: string;
  underline: boolean;
  strike: boolean;
  highlight?: string;
  link?: string;
}

interface Seg {
  /** 'text' uses a standard font; 'raster' is drawn by the browser. */
  kind: 'text' | 'raster';
  text: string;
  st: Style;
  width: number;
}

type Item =
  | { type: 'word'; segs: Seg[]; width: number }
  | { type: 'space'; st: Style; width: number }
  | { type: 'tab'; st: Style }
  | { type: 'image'; run: ImageRun; width: number; height: number }
  | { type: 'break' };

/** Something placed on a line, with its x offset from the line's left edge. */
type Placed =
  | { type: 'seg'; seg: Seg; x: number }
  | { type: 'image'; run: ImageRun; x: number; width: number; height: number }
  | { type: 'gap'; st: Style; x: number; width: number };

interface Line {
  placed: Placed[];
  width: number;
  ascent: number;
  descent: number;
}

const LINE_GAP = 1.2;
const TAB_STOP = 36;
const LIST_INDENT = 18;
const CELL_PAD = 5;

const STANDARD: Record<FontFamily, [string, string, string, string]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};
const CSS_FAMILY: Record<FontFamily, string> = {
  sans: 'Arial, Helvetica, "Noto Sans", "Nirmala UI", "Segoe UI", system-ui, sans-serif',
  serif: '"Times New Roman", Times, "Noto Serif", "Nirmala UI", serif',
  mono: '"Courier New", Courier, "Noto Sans Mono", monospace',
};

function rgbOf(lib: Lib, hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface LayoutResult {
  bytes: Uint8Array;
  pages: number;
  /** Words drawn as pictures because the built-in fonts lack their letters. */
  rasterWords: number;
}

class Layout {
  private fonts = new Map<string, PDFFont>();
  private charset: Set<number> | null = null;
  private images = new Map<Uint8Array, PDFImage>();
  private rasters = new Map<string, { image: PDFImage; width: number }>();
  private measure = getContext(createCanvas(1, 1));
  private page!: PDFPage;
  /** Distance from the top of the page to where the next thing goes. */
  private y = 0;
  rasterWords = 0;

  constructor(
    private lib: Lib,
    private out: PDFDocument,
    private doc: DocModel,
  ) {}

  private get m() {
    return this.doc.page.margin;
  }
  private get contentWidth() {
    return this.doc.page.width - this.m.left - this.m.right;
  }
  private get bottom() {
    return this.doc.page.height - this.m.bottom;
  }

  font(st: Pick<Style, 'family' | 'bold' | 'italic'>): PDFFont {
    const name = STANDARD[st.family][(st.bold ? 1 : 0) + (st.italic ? 2 : 0)];
    let f = this.fonts.get(name);
    if (!f) {
      f = this.out.embedStandardFont(name as Parameters<PDFDocument['embedStandardFont']>[0]);
      this.fonts.set(name, f);
    }
    return f;
  }

  private encodable(ch: string): boolean {
    this.charset ??= new Set(this.font({ family: 'sans', bold: false, italic: false }).getCharacterSet());
    return this.charset.has(ch.codePointAt(0)!);
  }

  private cssFont(st: Style, px: number): string {
    return `${st.italic ? 'italic ' : ''}${st.bold ? '700' : '400'} ${px}px ${CSS_FAMILY[st.family]}`;
  }

  /** Splits a word into stretches the standard font can write and stretches the browser must draw. */
  private segments(word: string, st: Style): Seg[] {
    const segs: Seg[] = [];
    for (const ch of word) {
      const kind = this.encodable(ch) ? 'text' : 'raster';
      const last = segs[segs.length - 1];
      if (last && last.kind === kind) last.text += ch;
      else segs.push({ kind, text: ch, st, width: 0 });
    }
    for (const s of segs) {
      if (s.kind === 'text') s.width = this.font(st).widthOfTextAtSize(s.text, st.size);
      else {
        this.measure.font = this.cssFont(st, st.size);
        s.width = this.measure.measureText(s.text).width;
      }
    }
    return segs;
  }

  private styleOf(r: Extract<Run, { type: 'text' }>, p: Paragraph): Style {
    const base = STYLE_METRICS[p.style];
    return {
      family: r.font ?? 'sans',
      bold: r.bold ?? base.bold,
      italic: r.italic ?? base.italic ?? false,
      size: r.size ?? base.size,
      color: r.color ?? (r.link ? '#0563c1' : p.style === 'quote' ? '#404040' : '#000000'),
      underline: r.underline ?? !!r.link,
      strike: r.strike ?? false,
      highlight: r.highlight,
      link: r.link,
    };
  }

  private items(p: Paragraph, maxImage: { width: number; height: number }): Item[] {
    const items: Item[] = [];
    let joinable = false;
    for (const r of p.runs) {
      if (r.type === 'break') {
        items.push({ type: 'break' });
        joinable = false;
        continue;
      }
      if (r.type === 'image') {
        const fit = Math.min(1, maxImage.width / r.width, maxImage.height / r.height);
        items.push({ type: 'image', run: r, width: r.width * fit, height: r.height * fit });
        joinable = false;
        continue;
      }
      const st = this.styleOf(r, p);
      const lines = r.text.split('\n');
      lines.forEach((lineText, li) => {
        if (li > 0) {
          items.push({ type: 'break' });
          joinable = false;
        }
        for (const m of lineText.matchAll(/(\t)|( +)|([^\t ]+)/g)) {
          if (m[1]) {
            items.push({ type: 'tab', st });
            joinable = false;
          } else if (m[2]) {
            items.push({ type: 'space', st, width: this.font(st).widthOfTextAtSize(' ', st.size) * m[2].length });
            joinable = false;
          } else {
            const segs = this.segments(m[3], st);
            const width = segs.reduce((n, s) => n + s.width, 0);
            const last = items[items.length - 1];
            // Text split across runs with no space between (e.g. a bold first letter) is one word.
            if (joinable && last?.type === 'word') {
              last.segs.push(...segs);
              last.width += width;
            } else items.push({ type: 'word', segs, width });
            joinable = true;
          }
        }
      });
    }
    return items;
  }

  /** Cuts a word too long for any line into pieces that fit. */
  private splitWord(word: Extract<Item, { type: 'word' }>, width: number): Extract<Item, { type: 'word' }>[] {
    const parts: Extract<Item, { type: 'word' }>[] = [];
    let current: Extract<Item, { type: 'word' }> = { type: 'word', segs: [], width: 0 };
    for (const seg of word.segs) {
      for (const ch of seg.text) {
        const w = this.segments(ch, seg.st)[0].width;
        if (current.width + w > width && current.segs.length) {
          parts.push(current);
          current = { type: 'word', segs: [], width: 0 };
        }
        const last = current.segs[current.segs.length - 1];
        if (last && last.st === seg.st && last.kind === seg.kind) {
          last.text += ch;
          last.width += w;
        } else current.segs.push({ ...seg, text: ch, width: w });
        current.width += w;
      }
    }
    if (current.segs.length) parts.push(current);
    return parts;
  }

  /** Breaks a paragraph into lines no wider than `width`, aligned as the paragraph asks. */
  lines(p: Paragraph, width: number, maxImageHeight: number): Line[] {
    const items = this.items(p, { width, height: maxImageHeight });
    // An empty line is as tall as the text it would hold.
    const firstText = p.runs.find((r) => r.type === 'text');
    const size = firstText ? this.styleOf(firstText, p).size : STYLE_METRICS[p.style].size;
    const lines: { items: Item[]; forced: boolean }[] = [];
    let current: Item[] = [];
    let x = 0;
    const end = (forced: boolean) => {
      while (current.length && current[current.length - 1].type === 'space') current.pop();
      lines.push({ items: current, forced });
      current = [];
      x = 0;
    };
    const queue = [...items];
    while (queue.length) {
      const item = queue.shift()!;
      if (item.type === 'break') {
        end(true);
        continue;
      }
      if (item.type === 'space') {
        if (current.length) {
          current.push(item);
          x += item.width;
        }
        continue;
      }
      if (item.type === 'tab') {
        current.push(item);
        x = (Math.floor(x / TAB_STOP) + 1) * TAB_STOP;
        if (x > width) end(false);
        continue;
      }
      const w = item.width;
      if (x + w > width && current.length) {
        end(false);
        queue.unshift(item);
        continue;
      }
      if (item.type === 'word' && w > width) {
        queue.unshift(...this.splitWord(item, width));
        continue;
      }
      current.push(item);
      x += w;
    }
    if (current.length || !lines.length) end(true);

    return lines.map(({ items: lineItems, forced }, index) => {
      const placed: Placed[] = [];
      let ascent = 0;
      let descent = 0;
      let cx = 0;
      for (const item of lineItems) {
        if (item.type === 'word') {
          for (const seg of item.segs) {
            placed.push({ type: 'seg', seg, x: cx });
            cx += seg.width;
            ascent = Math.max(ascent, seg.st.size * 0.8);
            descent = Math.max(descent, seg.st.size * (LINE_GAP - 0.8));
          }
        } else if (item.type === 'space') {
          placed.push({ type: 'gap', st: item.st, x: cx, width: item.width });
          cx += item.width;
        } else if (item.type === 'tab') {
          const next = (Math.floor(cx / TAB_STOP) + 1) * TAB_STOP;
          placed.push({ type: 'gap', st: item.st, x: cx, width: next - cx });
          cx = next;
        } else if (item.type === 'image') {
          placed.push({ type: 'image', run: item.run, x: cx, width: item.width, height: item.height });
          cx += item.width;
          ascent = Math.max(ascent, item.height);
        }
      }
      if (!ascent) {
        ascent = size * 0.8;
        descent = size * (LINE_GAP - 0.8);
      }
      // Alignment: move everything, or for justified text widen the spaces (not on a paragraph's last line).
      const free = width - cx;
      const align: Align = p.align;
      if (align === 'center' || align === 'right') {
        const shift = align === 'center' ? free / 2 : free;
        placed.forEach((pl) => (pl.x += shift));
      } else if (align === 'justify' && !forced && index < lines.length - 1 && free > 0) {
        const gaps = placed.filter((pl) => pl.type === 'gap').length;
        if (gaps) {
          const extra = free / gaps;
          let add = 0;
          for (const pl of placed) {
            pl.x += add;
            if (pl.type === 'gap') {
              pl.width += extra;
              add += extra;
            }
          }
          cx = width;
        }
      }
      return { placed, width: cx, ascent, descent };
    });
  }

  newPage(): void {
    this.page = this.out.addPage([this.doc.page.width, this.doc.page.height]);
    this.y = this.m.top;
  }

  /** Top-down y to PDF's bottom-up y. */
  private py(y: number): number {
    return this.doc.page.height - y;
  }

  private async rasterImage(seg: Seg): Promise<{ image: PDFImage; width: number }> {
    const key = `${this.cssFont(seg.st, seg.st.size)}|${seg.st.color}|${seg.text}`;
    const cached = this.rasters.get(key);
    if (cached) return cached;
    // Four pixels per point: sharp in print at the sizes documents use.
    const scale = 4;
    const height = Math.ceil(seg.st.size * LINE_GAP * scale);
    const canvas = createCanvas(Math.max(1, Math.ceil(seg.width * scale) + 2), height);
    const ctx = getContext(canvas);
    ctx.font = this.cssFont(seg.st, seg.st.size * scale);
    ctx.fillStyle = seg.st.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(seg.text, 0, seg.st.size * 0.9 * scale);
    const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    releaseCanvas(canvas);
    const result = { image: await this.out.embedPng(png), width: seg.width };
    this.rasters.set(key, result);
    this.rasterWords++;
    return result;
  }

  private async image(run: ImageRun): Promise<PDFImage> {
    let img = this.images.get(run.data);
    if (!img) {
      img = run.mime === 'image/png' ? await this.out.embedPng(run.data) : await this.out.embedJpg(run.data);
      this.images.set(run.data, img);
    }
    return img;
  }

  private addLink(x: number, yTop: number, width: number, height: number, url: string): void {
    const { PDFString } = this.lib;
    const annot = this.out.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, this.py(yTop + height), x + width, this.py(yTop)],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    });
    const ref = this.out.context.register(annot);
    this.page.node.addAnnot(ref);
  }

  /** Draws a line with its top at `top`, starting at `left`. */
  async drawLine(line: Line, left: number, top: number): Promise<void> {
    const { lib, page } = this;
    const baseline = top + line.ascent;
    for (const pl of line.placed) {
      if (pl.type === 'image') {
        const img = await this.image(pl.run);
        page.drawImage(img, { x: left + pl.x, y: this.py(baseline), width: pl.width, height: pl.height });
        continue;
      }
      const st = pl.type === 'seg' ? pl.seg.st : pl.st;
      const width = pl.type === 'seg' ? pl.seg.width : pl.width;
      const x = left + pl.x;
      // Spaces between two underlined or highlighted words carry the decoration too.
      if (st.highlight) {
        page.drawRectangle({ x, y: this.py(baseline + st.size * 0.25), width, height: st.size * 1.1, color: rgbOf(lib, st.highlight) });
      }
      if (pl.type === 'seg') {
        if (pl.seg.kind === 'text') {
          page.drawText(pl.seg.text, { x, y: this.py(baseline), size: st.size, font: this.font(st), color: rgbOf(lib, st.color) });
        } else {
          const r = await this.rasterImage(pl.seg);
          const h = st.size * LINE_GAP;
          page.drawImage(r.image, { x, y: this.py(baseline - st.size * 0.9 + h), width: r.image.width / 4, height: h });
        }
        if (st.link) this.addLink(x, baseline - st.size * 0.8, width, st.size * 1.05, st.link);
      }
      const thickness = Math.max(0.5, st.size / 18);
      if (st.underline && (pl.type === 'seg' || this.decoratedGap(line, pl))) {
        page.drawLine({ start: { x, y: this.py(baseline + st.size * 0.12) }, end: { x: x + width, y: this.py(baseline + st.size * 0.12) }, thickness, color: rgbOf(lib, st.color) });
      }
      if (st.strike && (pl.type === 'seg' || this.decoratedGap(line, pl))) {
        page.drawLine({ start: { x, y: this.py(baseline - st.size * 0.3) }, end: { x: x + width, y: this.py(baseline - st.size * 0.3) }, thickness, color: rgbOf(lib, st.color) });
      }
    }
  }

  /** A space is underlined only when the words on both sides are. */
  private decoratedGap(line: Line, gap: Placed): boolean {
    const i = line.placed.indexOf(gap);
    const prev = line.placed[i - 1];
    const next = line.placed.slice(i + 1).find((p) => p.type !== 'gap');
    return prev?.type === 'seg' && next?.type === 'seg';
  }

  /** Lays out and draws a paragraph in the main flow, starting new pages as needed. */
  async paragraph(p: Paragraph, counters: number[], kinds: boolean[]): Promise<void> {
    const metrics = STYLE_METRICS[p.style];
    const indent = p.list ? LIST_INDENT * (p.list.level + 1) : p.style === 'quote' ? 24 : 0;
    const width = this.contentWidth - indent - (p.style === 'quote' ? 24 : 0);
    const lines = this.lines(p, width, this.bottom - this.m.top);
    const atTop = this.y === this.m.top;
    if (!atTop) this.y += metrics.before;
    // Keep a heading with the first line after it by not starting one in the last few lines of a page.
    if (p.style !== 'normal' && p.style !== 'quote' && this.y + lines[0].ascent + lines[0].descent + 40 > this.bottom) this.newPage();

    let marker: string | null = null;
    if (p.list) {
      const level = p.list.level;
      counters.length = level + 1;
      // A numbered list right after a bulleted one (or the other way round) starts again at 1.
      if (kinds[level] !== p.list.ordered) counters[level] = 0;
      kinds.length = level + 1;
      kinds[level] = p.list.ordered;
      counters[level] = (counters[level] ?? 0) + 1;
      marker = p.list.ordered ? `${this.orderedLabel(counters[level], level)}.` : level % 2 ? '-' : '•';
    }

    const left = this.m.left + indent;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = line.ascent + line.descent;
      if (this.y + h > this.bottom && this.y > this.m.top) this.newPage();
      await this.drawLine(line, left, this.y);
      if (i === 0 && marker) {
        const st: Style = { family: 'sans', bold: false, italic: false, size: metrics.size, color: '#000000', underline: false, strike: false };
        const firstText = line.placed.find((pl) => pl.type === 'seg');
        if (firstText?.type === 'seg') st.size = firstText.seg.st.size;
        const font = this.font(st);
        const mw = font.widthOfTextAtSize(marker, st.size);
        this.page.drawText(marker, { x: left - mw - 5, y: this.py(this.y + line.ascent), size: st.size, font });
      }
      if (p.style === 'quote') {
        this.page.drawRectangle({ x: left - 12, y: this.py(this.y + h), width: 2.5, height: h, color: rgbOf(this.lib, '#c7c7cc') });
      }
      this.y += h;
    }
    this.y += p.list ? 3 : metrics.after;
  }

  private orderedLabel(n: number, level: number): string {
    if (level % 3 === 1) {
      let s = '';
      let k = n;
      while (k > 0) {
        s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
        k = Math.floor((k - 1) / 26);
      }
      return s;
    }
    if (level % 3 === 2) {
      const romans: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
      let s = '';
      let k = n;
      for (const [v, r] of romans) while (k >= v) {
        s += r;
        k -= v;
      }
      return s;
    }
    return String(n);
  }

  async table(t: Table): Promise<void> {
    const columns = Math.max(1, ...t.rows.map((row) => row.reduce((n, c) => n + (c.span ?? 1), 0)));
    const colWidth = this.contentWidth / columns;
    const border = rgbOf(this.lib, '#9ca3af');
    if (this.y > this.m.top) this.y += 4;
    for (const row of t.rows) {
      // Lay out every cell first, to know the row's height.
      let col = 0;
      const cells = row.map((cell) => {
        const span = Math.min(cell.span ?? 1, columns - col);
        const x = this.m.left + col * colWidth;
        const width = colWidth * span;
        col += span;
        const blocks = cell.paragraphs.map((p) => ({ p, lines: this.lines(p, width - CELL_PAD * 2, this.bottom - this.m.top) }));
        const height =
          blocks.reduce((h, b, i) => h + b.lines.reduce((n, l) => n + l.ascent + l.descent, 0) + (i < blocks.length - 1 ? 4 : 0), 0) +
          CELL_PAD * 2;
        return { cell, x, width, blocks, height };
      });
      const rowHeight = Math.max(16, ...cells.map((c) => c.height));
      if (this.y + rowHeight > this.bottom && this.y > this.m.top) this.newPage();
      for (const c of cells) {
        const rect = { x: c.x, y: this.py(this.y + rowHeight), width: c.width, height: rowHeight };
        if (c.cell.shade) this.page.drawRectangle({ ...rect, color: rgbOf(this.lib, c.cell.shade) });
        this.page.drawRectangle({ ...rect, borderColor: border, borderWidth: 0.6 });
        let y = this.y + CELL_PAD;
        for (const b of c.blocks) {
          for (const line of b.lines) {
            await this.drawLine(line, c.x + CELL_PAD, y);
            y += line.ascent + line.descent;
          }
          y += 4;
        }
      }
      this.y += rowHeight;
    }
    this.y += 10;
  }

  async run(onProgress?: (ratio: number) => void): Promise<void> {
    this.newPage();
    // List numbers per level, and whether each level is numbered or bulleted.
    const counters: number[] = [];
    const kinds: boolean[] = [];
    const { blocks } = this.doc;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'pagebreak') {
        this.newPage();
        counters.length = 0;
      } else if (b.type === 'table') {
        counters.length = 0;
        await this.table(b);
      } else {
        if (!b.list) counters.length = 0;
        await this.paragraph(b, counters, kinds);
      }
      if (i % 25 === 0) {
        onProgress?.(i / blocks.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
}

/** Lays out a document as a new PDF. */
export async function layoutPdf(doc: DocModel, options: { title?: string; onProgress?: (ratio: number) => void } = {}): Promise<LayoutResult> {
  const lib = await import('@cantoo/pdf-lib');
  const out = await lib.PDFDocument.create();
  out.setProducer('CompressKit');
  out.setCreator('CompressKit (in-browser)');
  if (options.title) out.setTitle(options.title);
  const layout = new Layout(lib, out, doc);
  await layout.run(options.onProgress);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pages: out.getPageCount(), rasterWords: layout.rasterWords };
}
