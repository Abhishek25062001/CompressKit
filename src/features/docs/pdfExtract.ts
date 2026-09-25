import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';
import { closePdf, loadPdfjs, openPdf } from '../pdf/documents';
import { recognizePage } from '../pdf/ocr';
import { renderPage } from '../pdf/render';
import { A4, type Align, type Block, type DocModel, type ImageRun, type Paragraph, type ParagraphStyle, type TextRun } from './model';

/**
 * Turns a PDF back into an editable document. A PDF stores positioned pieces of text, not
 * paragraphs, so the words are regrouped: pieces on one baseline become a line, lines that follow
 * each other closely become a paragraph, larger text becomes a heading and "•" or "1." starts a
 * list item. Pictures are pulled out at their place in the reading order. Scanned pages have no
 * text to regroup; they are read with OCR when asked, or kept as a picture of the page.
 */

export interface ExtractOptions {
  /** Reads scanned pages with OCR (English), instead of keeping them as pictures. */
  ocr: boolean;
  images: boolean;
  /** Starts each PDF page on a new page of the document. */
  pageBreaks?: boolean;
  password?: string;
  onProgress?: (ratio: number, stage?: string) => void;
}

export interface ExtractResult {
  doc: DocModel;
  pages: number;
  scannedPages: number;
  ocrPages: number;
}

interface Piece {
  text: string;
  x: number;
  /** Baseline, from the top of the page. */
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  serif: boolean;
}

interface TextLine {
  pieces: Piece[];
  y: number;
  left: number;
  right: number;
  size: number;
}

type FlowItem = { kind: 'line'; line: TextLine; top: number } | { kind: 'image'; run: ImageRun; top: number; left: number };

const BULLET = /^([*\u2022\u25cf\u25aa\u25e6\u25cb\u25a0\u25a1\u25ba\u25b8\u2023\u2043\u2219\u00b7\u2013\u2014-]|\uf0b7|\uf0a7|\uf076|\uf0d8)\s*/;
const NUMBERED = /^(\(?(\d{1,3}|[a-z]|[ivx]{1,4})[.)])\s+/i;

function fontFlags(page: PDFPageProxy, fontName: string, family: string | undefined) {
  let name = family ?? '';
  let bold = false;
  let italic = false;
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean };
      name = `${font.name ?? ''} ${name}`;
      bold = !!(font.bold || font.black);
      italic = !!font.italic;
    }
  } catch {
    // Font not loaded; fall back to the family name.
  }
  return {
    bold: bold || /bold|black|heavy|semibold|demi/i.test(name),
    italic: italic || /italic|oblique/i.test(name),
    mono: /mono|courier|consol/i.test(name),
    serif: /times|serif|georgia|garamond|cambria|book/i.test(name) && !/sans/i.test(name),
  };
}

/** The page's text as positioned pieces, top-down in the viewport's coordinates. Load fonts first. */
async function readPieces(page: PDFPageProxy, viewport: ReturnType<PDFPageProxy['getViewport']>): Promise<Piece[]> {
  const { Util } = await loadPdfjs();
  const content = await page.getTextContent();
  const pieces: Piece[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const tx = Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 1) continue;
    const flags = fontFlags(page, item.fontName, content.styles[item.fontName]?.fontFamily);
    pieces.push({ text: item.str, x: tx[4], y: tx[5], width: item.width * (viewport.scale || 1), size, ...flags });
  }
  return pieces;
}

/** A line of existing text on a page, as fractions of the page as displayed. */
export interface PageTextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text size as a fraction of the page height. */
  size: number;
  bold: boolean;
  italic: boolean;
  font: 'sans' | 'serif' | 'mono';
}

/**
 * Lines of text on a page, for replacing text in Edit PDF. Columns (pieces far apart on one
 * baseline) are separate lines, so clicking a table cell picks just that cell.
 */
export async function pageTextLines(page: PDFPageProxy, extraRotation: number): Promise<PageTextLine[]> {
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + extraRotation) % 360 });
  await page.getOperatorList();
  const pieces = await readPieces(page, viewport);
  const out: PageTextLine[] = [];
  for (const line of buildLines(pieces)) {
    let group: Piece[] = [];
    const flush = () => {
      const text = group.map((p, i) => (i && group[i - 1].x + group[i - 1].width < p.x - p.size * 0.18 && !/\s$/.test(group[i - 1].text) ? ' ' : '') + p.text).join('').trim();
      if (text) {
        const size = Math.max(...group.map((p) => p.size));
        const left = group[0].x;
        const right = Math.max(...group.map((p) => p.x + p.width));
        const main = group.reduce((a, b) => (b.text.length > a.text.length ? b : a));
        out.push({
          text,
          x: left / viewport.width,
          y: (line.y - size * 0.92) / viewport.height,
          width: (right - left) / viewport.width,
          height: (size * 1.2) / viewport.height,
          size: size / viewport.height,
          bold: main.bold,
          italic: main.italic,
          font: main.mono ? 'mono' : main.serif ? 'serif' : 'sans',
        });
      }
      group = [];
    };
    for (const p of line.pieces) {
      const prev = group[group.length - 1];
      if (prev && p.x - (prev.x + prev.width) > p.size * 2) flush();
      group.push(p);
    }
    flush();
  }
  page.cleanup();
  return out;
}

/** Pieces of text grouped into lines, top to bottom, each line left to right. */
function buildLines(pieces: Piece[]): TextLine[] {
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const p of sorted) {
    const line = lines.find((l) => Math.abs(l.y - p.y) < Math.max(2, Math.min(l.size, p.size) * 0.45));
    if (line) {
      line.pieces.push(p);
      line.size = Math.max(line.size, p.size);
    } else lines.push({ pieces: [p], y: p.y, left: 0, right: 0, size: p.size });
  }
  for (const l of lines) {
    l.pieces.sort((a, b) => a.x - b.x);
    l.left = l.pieces[0].x;
    l.right = Math.max(...l.pieces.map((p) => p.x + p.width));
    // A line's size is its most common text size, so one large initial does not make it a heading.
    const weight = new Map<number, number>();
    for (const p of l.pieces) weight.set(Math.round(p.size), (weight.get(Math.round(p.size)) ?? 0) + p.text.length);
    l.size = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return lines.sort((a, b) => a.y - b.y);
}

/** A line's pieces as runs, with spaces (or tabs, for wide gaps) where the pieces are apart. */
function lineRuns(line: TextLine, bodySize: number): TextRun[] {
  const runs: TextRun[] = [];
  let prev: Piece | null = null;
  for (const p of line.pieces) {
    let text = p.text;
    if (prev) {
      const gap = p.x - (prev.x + prev.width);
      const spaced = /\s$/.test(prev.text) || /^\s/.test(text);
      if (gap > p.size * 2.5) text = `\t${text.trimStart()}`;
      else if (gap > p.size * 0.18 && !spaced) text = ` ${text}`;
    }
    const size = Math.abs(p.size - bodySize) > 0.6 ? Math.round(p.size * 2) / 2 : undefined;
    const props = {
      bold: p.bold || undefined,
      italic: p.italic || undefined,
      size,
      font: p.mono ? ('mono' as const) : p.serif ? ('serif' as const) : undefined,
    };
    const last = runs[runs.length - 1];
    if (last && last.bold === props.bold && last.italic === props.italic && last.size === props.size && last.font === props.font) {
      last.text += text;
    } else runs.push({ type: 'text', text, ...props });
    prev = p;
  }
  return runs;
}

/** Converts pdf.js image data to a PNG or JPEG the document can hold. */
async function imageBytes(img: { width: number; height: number; bitmap?: ImageBitmap; data?: Uint8ClampedArray | Uint8Array; kind?: number }) {
  const canvas = createCanvas(img.width, img.height);
  const ctx = getContext(canvas);
  let alpha = false;
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    const d = img.data;
    if (img.kind === 3) {
      rgba.set(d.subarray(0, rgba.length));
      alpha = true;
    } else if (img.kind === 2) {
      for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
        rgba[j] = d[i];
        rgba[j + 1] = d[i + 1];
        rgba[j + 2] = d[i + 2];
        rgba[j + 3] = 255;
      }
    } else {
      // One bit per pixel, rows padded to whole bytes.
      const rowBytes = Math.ceil(img.width / 8);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const bit = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const j = (y * img.width + x) * 4;
          rgba[j] = rgba[j + 1] = rgba[j + 2] = bit ? 255 : 0;
          rgba[j + 3] = 255;
        }
      }
    }
    ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  } else {
    releaseCanvas(canvas);
    return null;
  }
  if (img.bitmap) {
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) {
      alpha = true;
      break;
    }
  }
  const blob = await canvasToBlob(canvas, alpha ? 'image/png' : 'image/jpeg', 0.88);
  releaseCanvas(canvas);
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: (alpha ? 'image/png' : 'image/jpeg') as ImageRun['mime'] };
}

/** Waits for an image object pdf.js is still sending from its worker. */
function getObj(store: PDFPageProxy['objs'], id: string): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    try {
      store.get(id, (obj: unknown) => {
        clearTimeout(timer);
        resolve(obj);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Pictures drawn on the page, with where they sit (top-down, in points). */
async function pageImages(page: PDFPageProxy, viewportTransform: number[], pageArea: number) {
  const pdfjs = await loadPdfjs();
  const { OPS, Util } = pdfjs;
  const list = await page.getOperatorList();
  const found: { run: ImageRun; top: number; left: number; area: number }[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (let i = 0; i < list.fnArray.length && found.length < 60; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[]);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const m = Util.transform(viewportTransform, ctm);
      // The picture fills the unit square under the current matrix.
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - left;
      const height = Math.max(...ys) - top;
      if (width < 24 || height < 24) continue;
      let obj: unknown = args[0];
      if (typeof obj === 'string') obj = await getObj(obj.startsWith('g_') ? page.commonObjs : page.objs, obj);
      if (!obj) continue;
      const bytes = await imageBytes(obj as Parameters<typeof imageBytes>[0]);
      if (!bytes) continue;
      found.push({ run: { type: 'image', ...bytes, width, height }, top, left, area: (width * height) / pageArea });
    }
  }
  return { found, ops: list.fnArray.length };
}

/**
 * Reads a scanned page with OCR and returns its lines in page points, so they are regrouped into
 * headings, lists and paragraphs like text from any other page. OCR does not report text sizes;
 * a line's size is estimated from its tallest word, which usually has an ascender or descender.
 */
async function ocrLines(source: PdfSource, index: number, width: number, height: number, onProgress: (r: number) => void): Promise<TextLine[]> {
  const result = await recognizePage(
    { id: createId(), sourceId: source.id, index, rotation: 0, selected: false, thumbUrl: null, signatures: [] },
    source,
    (r) => onProgress(r),
  );
  const sx = width / result.width;
  const sy = height / result.height;
  const pieces: Piece[] = result.words.map((w) => ({
    text: w.text,
    x: w.x0 * sx,
    y: w.y1 * sy,
    width: (w.x1 - w.x0) * sx,
    size: ((w.y1 - w.y0) * sy) / 0.95,
    bold: false,
    italic: false,
    mono: false,
    serif: false,
  }));
  const lines = buildLines(pieces);
  for (const line of lines) {
    const size = Math.round(Math.max(...line.pieces.map((p) => p.size)) * 2) / 2;
    line.size = size;
    line.pieces.forEach((p) => (p.size = size));
  }
  return lines;
}

async function pagePicture(source: PdfSource, index: number, contentWidth: number): Promise<Paragraph | null> {
  const canvas = await renderPage({ sourceId: source.id, index }, source, 150 / 72, 0, '#ffffff');
  const w = canvas.width;
  const h = canvas.height;
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
  releaseCanvas(canvas);
  const scale = contentWidth / w;
  return {
    type: 'paragraph',
    style: 'normal',
    align: 'center',
    runs: [{ type: 'image', data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: contentWidth, height: h * scale }],
  };
}

export async function pdfToDoc(file: File, options: ExtractOptions): Promise<ExtractResult> {
  const sourceId = createId();
  const opened = await openPdf(sourceId, file, options.password);
  const source: PdfSource = { id: sourceId, name: file.name, kind: 'pdf', file, pageCount: opened.view.numPages };
  const progress = options.onProgress ?? (() => undefined);
  try {
    const numPages = opened.view.numPages;
    const perPage: { elements: FlowItem[]; width: number; height: number; scanned: boolean; picture?: Paragraph | null }[] = [];
    const sizes = new Map<number, number>();
    let scannedPages = 0;
    let ocrPages = 0;

    // Pass 1: read every page's text and pictures.
    for (let n = 1; n <= numPages; n++) {
      progress((n - 1) / numPages, `Reading page ${n} of ${numPages}`);
      const page = await opened.view.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      // The operator list loads the page's fonts (for bold and italic) and lists its pictures.
      const drawn = await pageImages(page, viewport.transform, viewport.width * viewport.height);
      const images = drawn.found;
      const pieces = await readPieces(page, viewport);
      for (const pc of pieces) sizes.set(Math.round(pc.size), (sizes.get(Math.round(pc.size)) ?? 0) + pc.text.length);
      const chars = pieces.reduce((c, p) => c + p.text.trim().length, 0);
      const elements: FlowItem[] = buildLines(pieces).map((line) => ({ kind: 'line', line, top: line.y - line.size }));
      // A page with almost no text but something drawn on it is a scan (or a drawing): it is read
      // with OCR or kept whole as a picture.
      const scanned = chars < 20 && (images.length > 0 || drawn.ops > 12);
      // Stray text on a scan (a page number, a stamp) is dropped; the page is read or kept whole.
      if (scanned) {
        scannedPages++;
        elements.length = 0;
      } else if (options.images) {
        for (const img of images) {
          // A picture under the whole page with text on top is a scan with a text layer, or a background.
          if (img.area > 0.85) continue;
          elements.push({ kind: 'image', run: img.run, top: img.top, left: img.left });
        }
      }
      elements.sort((a, b) => a.top - b.top);
      perPage.push({ elements, width: viewport.width, height: viewport.height, scanned });
      page.cleanup();
    }

    // Pass 2: scanned pages are read with OCR, when asked.
    if (options.ocr) {
      for (let i = 0; i < perPage.length; i++) {
        const p = perPage[i];
        if (!p.scanned) continue;
        const lines = await ocrLines(source, i, p.width, p.height, (r) => progress((i + r) / numPages, `Reading scanned page ${i + 1} with OCR`));
        if (!lines.length) continue;
        ocrPages++;
        p.elements = lines.map((line) => ({ kind: 'line', line, top: line.y - line.size }));
        for (const line of lines) for (const pc of line.pieces) sizes.set(Math.round(pc.size), (sizes.get(Math.round(pc.size)) ?? 0) + pc.text.length);
      }
    }

    const first = perPage[0];
    const pageSize = first ? { width: first.width, height: first.height } : A4;
    // Margins from where the text sits, within sensible limits.
    const allLines = perPage.flatMap((p) => p.elements.flatMap((e) => (e.kind === 'line' ? [e.line] : [])));
    const textLeft = allLines.length ? Math.min(...allLines.map((l) => l.left)) : 72;
    const textRight = allLines.length ? Math.max(...allLines.map((l) => l.right)) : pageSize.width - 72;
    const side = Math.min(90, Math.max(36, Math.min(textLeft, pageSize.width - textRight)));
    const page = { ...pageSize, margin: { top: 60, bottom: 60, left: side, right: side } };
    const contentWidth = page.width - side * 2;
    const bodySize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;

    // Pass 3: a picture of each scanned page that OCR did not read.
    for (let i = 0; i < perPage.length; i++) {
      if (perPage[i].scanned && !perPage[i].elements.length) perPage[i].picture = await pagePicture(source, i, contentWidth);
    }

    // Pass 4: lines into paragraphs.
    const blocks: Block[] = [];
    const textWidth = Math.max(1, textRight - textLeft);
    perPage.forEach((p, pageIndex) => {
      if (pageIndex > 0 && options.pageBreaks !== false) blocks.push({ type: 'pagebreak' });
      if (p.picture) {
        blocks.push(p.picture);
        return;
      }
      let current: { para: Paragraph; last: TextLine; lines: TextLine[] } | null = null;
      // Lists nest by indent, measured from the page's least indented list marker.
      const listLefts = p.elements.flatMap((e) => {
        if (e.kind !== 'line') return [];
        const t = e.line.pieces.map((pc) => pc.text).join('').trimStart();
        return BULLET.test(t) || NUMBERED.test(t) ? [e.line.left] : [];
      });
      const listLeft = listLefts.length ? Math.min(...listLefts) : textLeft;
      const finish = () => {
        if (!current) return;
        const { para, lines } = current;
        // One short line in the middle of the page is centered; one ending at the right edge, right-aligned.
        const left = Math.min(...lines.map((l) => l.left));
        const right = Math.max(...lines.map((l) => l.right));
        const center = (left + right) / 2;
        let align: Align = 'left';
        if (Math.abs(center - p.width / 2) < p.width * 0.04 && left > textLeft + textWidth * 0.1) align = 'center';
        else if (Math.abs(right - textRight) < 6 && left > textLeft + textWidth * 0.35) align = 'right';
        para.align = align;
        blocks.push(para);
        current = null;
      };
      for (const el of p.elements) {
        if (el.kind === 'image') {
          finish();
          const fit = Math.min(1, contentWidth / el.run.width);
          blocks.push({
            type: 'paragraph',
            style: 'normal',
            align: el.left > p.width * 0.3 && el.left + el.run.width < p.width * 0.7 ? 'center' : 'left',
            runs: [{ ...el.run, width: el.run.width * fit, height: el.run.height * fit }],
          });
          continue;
        }
        const line = el.line;
        const runs = lineRuns(line, bodySize);
        const text = runs.map((r) => r.text).join('');
        if (!text.trim()) continue;
        const ratio = line.size / bodySize;
        // Larger text such as "1. Scope" is a numbered heading, not a list item; a marker with
        // nothing after it is not a list item either.
        const trimmed = text.trimStart();
        const bullet = ratio < 1.15 ? BULLET.exec(trimmed) : null;
        const numbered = ratio < 1.15 && !bullet ? NUMBERED.exec(trimmed) : null;
        // A marker on its own (a stray dash, or a bullet whose text is a picture) is skipped.
        if ((bullet || numbered) && !trimmed.slice((bullet ?? numbered)![0].length).trim()) continue;
        const allBold = line.pieces.every((pc) => pc.bold || !pc.text.trim());
        let style: ParagraphStyle = 'normal';
        if (ratio >= 1.9 && pageIndex === 0 && !blocks.some((b) => b.type === 'paragraph' && b.style === 'title')) style = 'title';
        else if (ratio >= 1.45) style = 'h1';
        else if (ratio >= 1.2) style = 'h2';
        else if (ratio >= 1.05 && allBold && text.length < 120) style = 'h3';

        const prev: TextLine | undefined = current?.last;
        const gap = prev ? line.y - prev.y : 0;
        const continues =
          current &&
          prev &&
          !bullet &&
          !numbered &&
          current.para.style === style &&
          Math.abs(line.size - prev.size) <= 1 &&
          gap < prev.size * 1.75 &&
          gap > 0 &&
          // A short previous line usually ends its paragraph.
          prev.right > textRight - textWidth * 0.22 &&
          // Wrapped lines of a list item line up with its text, to the right of the marker.
          line.left < prev.left + line.size * (current.para.list ? 3 : 1.5);

        if (continues && current) {
          const para = current.para;
          const lastRun = para.runs[para.runs.length - 1] as TextRun | undefined;
          if (lastRun && /[a-z]-$/.test(lastRun.text) && /^[a-z]/.test(text)) lastRun.text = lastRun.text.slice(0, -1);
          else if (lastRun && !/\s$/.test(lastRun.text)) runs[0] = { ...runs[0], text: ` ${runs[0].text.trimStart()}` };
          para.runs.push(...runs);
          current.last = line;
          current.lines.push(line);
          continue;
        }
        finish();
        if (bullet || numbered) {
          const marker = (bullet || numbered || [''])[0];
          let cut = marker.length;
          // Remove the marker from the runs' text.
          const lead = text.length - text.trimStart().length;
          cut += lead;
          while (cut > 0 && runs.length) {
            const r = runs[0];
            if (r.text.length <= cut) {
              cut -= r.text.length;
              runs.shift();
            } else {
              runs[0] = { ...r, text: r.text.slice(cut) };
              cut = 0;
            }
          }
          const level = Math.max(0, Math.min(3, Math.round((line.left - listLeft) / 18)));
          current = {
            para: { type: 'paragraph', style: 'normal', align: 'left', list: { ordered: !!numbered, level }, runs },
            last: line,
            lines: [line],
          };
          continue;
        }
        if (style !== 'normal') for (const r of runs) {
          delete r.size;
          delete r.bold;
        }
        current = { para: { type: 'paragraph', style, align: 'left', runs }, last: line, lines: [line] };
      }
      finish();
    });

    progress(1, 'Writing document');
    return { doc: { page, blocks }, pages: numPages, scannedPages, ocrPages };
  } finally {
    closePdf(sourceId);
  }
}
