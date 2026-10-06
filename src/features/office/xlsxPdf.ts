import type { PDFPage } from '@cantoo/pdf-lib';
import { familyOf, PdfTextPainter, rgbOf, type TextStyle } from './pdfText';
import type { Cell, CellStyle, Range, Sheet, Workbook } from './xlsxRead';

/**
 * Prints a workbook to PDF the way Excel does: each sheet's used range (or print area) on pages
 * with Excel's default margins, columns fitted to the page width or split across pages, title rows
 * repeated, and every cell drawn with its fill, borders, font, alignment and number format. Text
 * stays real text in the PDF.
 */

export interface SheetPdfOptions {
  page: 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Shrinks wide sheets so all columns fit across one page. */
  fitWidth: boolean;
  gridlines: boolean;
  onProgress?: (ratio: number) => void;
}

export interface SheetPdfResult {
  bytes: Uint8Array;
  pages: number;
  rasterized: number;
}

type Lib = typeof import('@cantoo/pdf-lib');

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
/** Excel's "Normal" margins: 0.7 inch at the sides, 0.75 inch at top and bottom. */
const MARGIN_X = 50.4;
const MARGIN_Y = 54;
const PAD = 2.2;
const MIN_SCALE = 0.3;

interface Geometry {
  cols: number[];
  colX: Map<number, number>;
  colW: Map<number, number>;
  rows: number[];
  rowY: Map<number, number>;
  rowH: Map<number, number>;
  width: number;
  height: number;
}

const BORDER_WIDTH: Record<string, number> = { hair: 0.25, thin: 0.5, dotted: 0.5, dashed: 0.5, dashDot: 0.5, dashDotDot: 0.5, medium: 1, mediumDashed: 1, mediumDashDot: 1, mediumDashDotDot: 1, slantDashDot: 1, thick: 1.5, double: 0.5 };
const BORDER_DASH: Record<string, number[]> = { dotted: [0.5, 1.5], dashed: [3, 1.5], mediumDashed: [4, 2], dashDot: [3, 1.5, 0.5, 1.5], mediumDashDot: [4, 2, 1, 2], dashDotDot: [3, 1, 0.5, 1, 0.5, 1], mediumDashDotDot: [4, 1.5, 1, 1.5, 1, 1.5], slantDashDot: [4, 1.5, 1, 1.5], hair: [1, 1] };

function styleOf(styles: CellStyle[], i: number): CellStyle {
  return styles[i] ?? styles[0];
}

function textStyle(st: CellStyle, color: string | undefined, scale: number): TextStyle {
  return {
    family: familyOf(st.font.name),
    bold: st.font.bold,
    italic: st.font.italic,
    size: Math.max(1, st.font.size * scale),
    color: color ?? st.font.color,
    underline: st.font.underline,
    strike: st.font.strike,
  };
}

/** The part of the sheet to print: the print area, or every row and column with something in it. */
function usedRange(sheet: Sheet, styles: CellStyle[]): Range | null {
  if (sheet.printArea) return sheet.printArea;
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -1;
  let c2 = -1;
  const take = (r: number, c: number) => {
    r1 = Math.min(r1, r);
    r2 = Math.max(r2, r);
    c1 = Math.min(c1, c);
    c2 = Math.max(c2, c);
  };
  for (const [r, cells] of sheet.rows) {
    for (const [c, cell] of cells) {
      const st = styleOf(styles, cell.style);
      const b = st.border;
      if (cell.text !== '' || st.fill || b.top || b.bottom || b.left || b.right) take(r, c);
    }
  }
  for (const m of sheet.merges) {
    take(m.r1, m.c1);
    take(m.r2, m.c2);
  }
  for (const img of sheet.images) take(img.from.row, img.from.col);
  if (r2 < 0) return null;
  return { r1, c1, r2, c2 };
}

function mergeMap(sheet: Sheet): Map<string, Range> {
  const map = new Map<string, Range>();
  for (const m of sheet.merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) map.set(`${r}:${c}`, m);
  return map;
}

export async function workbookToPdf(workbook: Workbook, options: SheetPdfOptions): Promise<SheetPdfResult> {
  const lib: Lib = await import('@cantoo/pdf-lib');
  const out = await lib.PDFDocument.create();
  out.setProducer('ofctools');
  out.setCreator('ofctools (in-browser)');
  const painter = new PdfTextPainter(lib, out);
  const { styles } = workbook;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  for (let si = 0; si < workbook.sheets.length; si++) {
    const sheet = workbook.sheets[si];
    const range = usedRange(sheet, styles);
    if (!range) continue;
    const merges = mergeMap(sheet);

    // Row heights: stored heights, or grown to fit wrapped text and large fonts, as Excel's autofit does.
    const colWidth = (c: number) => (sheet.hiddenCols.has(c) ? 0 : (sheet.colWidths.get(c) ?? sheet.defaultColWidth));
    const rowHeight = (r: number): number => {
      if (sheet.hiddenRows.has(r)) return 0;
      const stored = sheet.rowHeights.get(r);
      if (stored !== undefined) return stored;
      let h = sheet.defaultRowHeight;
      for (const [c, cell] of sheet.rows.get(r) ?? []) {
        if (!cell.text || merges.has(`${r}:${c}`)) continue;
        const st = styleOf(styles, cell.style);
        const ts = textStyle(st, undefined, 1);
        const lines = st.wrap ? painter.wrap(cell.text, Math.max(4, colWidth(c) - PAD * 2 - st.indent * 9), ts).length : 1;
        h = Math.max(h, lines * st.font.size * 1.22 + 3);
      }
      return h;
    };

    const geo: Geometry = { cols: [], colX: new Map(), colW: new Map(), rows: [], rowY: new Map(), rowH: new Map(), width: 0, height: 0 };
    for (let c = range.c1; c <= range.c2; c++) {
      const w = colWidth(c);
      geo.colX.set(c, geo.width);
      geo.colW.set(c, w);
      if (w > 0) geo.cols.push(c);
      geo.width += w;
    }
    for (let r = range.r1; r <= range.r2; r++) {
      const h = rowHeight(r);
      geo.rowY.set(r, geo.height);
      geo.rowH.set(r, h);
      if (h > 0) geo.rows.push(r);
      geo.height += h;
    }
    if (!geo.cols.length || !geo.rows.length) continue;

    // Page size and scale.
    const [pw, ph] = SIZES[options.page];
    const portraitWidth = pw - MARGIN_X * 2;
    const landscape =
      options.orientation === 'landscape' ||
      (options.orientation === 'auto' && (sheet.landscape ?? geo.width > portraitWidth * 1.02));
    const pageW = landscape ? ph : pw;
    const pageH = landscape ? pw : ph;
    const contentW = pageW - MARGIN_X * 2;
    const contentH = pageH - MARGIN_Y * 2;
    const fit = options.fitWidth || sheet.fitToWidth === 1;
    const scale = fit ? Math.max(MIN_SCALE, Math.min(1, contentW / geo.width)) : 1;

    // Column bands: columns that fit across one page.
    const bands: number[][] = [];
    let band: number[] = [];
    let bandWidth = 0;
    for (const c of geo.cols) {
      const w = geo.colW.get(c)!;
      if (band.length && (bandWidth + w) * scale > contentW + 0.5) {
        bands.push(band);
        band = [];
        bandWidth = 0;
      }
      band.push(c);
      bandWidth += w;
    }
    if (band.length) bands.push(band);

    // Title rows, repeated on every page after the first.
    const titles = sheet.titleRows ? geo.rows.filter((r) => r >= sheet.titleRows!.r1 && r <= sheet.titleRows!.r2) : [];
    const titleH = titles.reduce((h, r) => h + geo.rowH.get(r)!, 0);

    // Row pages: rows that fit down one page (Excel's order: down, then over).
    const rowPages: number[][] = [];
    let pageRows: number[] = [];
    let used = 0;
    for (const r of geo.rows) {
      const h = geo.rowH.get(r)!;
      const reserve = rowPages.length && !titles.includes(r) ? titleH : 0;
      if (pageRows.length && (used + h + reserve) * scale > contentH + 0.5) {
        rowPages.push(pageRows);
        pageRows = [];
        used = 0;
      }
      pageRows.push(r);
      used += h;
    }
    if (pageRows.length) rowPages.push(pageRows);

    const totalPages = bands.length * rowPages.length;
    let pageNo = 0;
    for (const cols of bands) {
      for (let pi = 0; pi < rowPages.length; pi++) {
        const rows = pi > 0 && titles.length ? [...titles, ...rowPages[pi].filter((r) => !titles.includes(r))] : rowPages[pi];
        const page = out.addPage([pageW, pageH]);
        // Title rows count as titles only when repeated; on their own first page they are ordinary rows.
        const repeated = new Set(pi > 0 ? titles : []);
        await drawPage(lib, page, painter, sheet, styles, geo, merges, cols, rows, scale, pageH, options.gridlines && sheet.showGrid, repeated);
        pageNo++;
        options.onProgress?.((si + pageNo / totalPages) / workbook.sheets.length);
        await tick();
      }
    }
  }
  if (!out.getPageCount()) out.addPage([...SIZES[options.page]] as [number, number]);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pages: out.getPageCount(), rasterized: painter.rasterized };
}

async function drawPage(
  lib: Lib,
  page: PDFPage,
  painter: PdfTextPainter,
  sheet: Sheet,
  styles: CellStyle[],
  geo: Geometry,
  merges: Map<string, Range>,
  cols: number[],
  rows: number[],
  scale: number,
  pageH: number,
  gridlines: boolean,
  titleRows: Set<number>,
): Promise<void> {
  const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = lib;
  // Page positions for the columns and rows on this page (rows may skip, when title rows repeat).
  const x = new Map<number, number>();
  let cx = 0;
  for (const c of cols) {
    x.set(c, cx);
    cx += geo.colW.get(c)!;
  }
  const y = new Map<number, number>();
  let cy = 0;
  for (const r of rows) {
    y.set(r, cy);
    cy += geo.rowH.get(r)!;
  }
  const toPdf = (sx: number, sy: number) => ({ x: MARGIN_X + sx * scale, y: pageH - MARGIN_Y - sy * scale });

  /** A cell's box on the page, following a merge; null when another cell's merge covers it. */
  const boxOf = (r: number, c: number) => {
    const m = merges.get(`${r}:${c}`);
    if (m && (m.r1 !== r || m.c1 !== c)) {
      // The merge's first cell may be on an earlier page; the first visible cell draws it then.
      const firstRow = rows.find((rr) => rr >= m.r1 && rr <= m.r2);
      const firstCol = cols.find((cc) => cc >= m.c1 && cc <= m.c2);
      if (r !== firstRow || c !== firstCol) return null;
    }
    const left = x.get(c)!;
    const top = y.get(r)!;
    let right = left + geo.colW.get(c)!;
    let bottom = top + geo.rowH.get(r)!;
    if (m) {
      for (const cc of cols) if (cc > c && cc <= m.c2) right = Math.max(right, x.get(cc)! + geo.colW.get(cc)!);
      for (const rr of rows) if (rr > r && rr <= m.r2) bottom = Math.max(bottom, y.get(rr)! + geo.rowH.get(rr)!);
    }
    return { left, top, right, bottom, merge: m, anchor: m ? { r: m.r1, c: m.c1 } : { r, c } };
  };
  const cellAt = (r: number, c: number): Cell | undefined => sheet.rows.get(r)?.get(c);

  const boxes: { r: number; c: number; box: NonNullable<ReturnType<typeof boxOf>> }[] = [];
  for (const r of rows) for (const c of cols) {
    const box = boxOf(r, c);
    if (box) boxes.push({ r, c, box });
  }

  // 1. Gridlines, under everything.
  if (gridlines) {
    const color = lib.rgb(0.83, 0.83, 0.83);
    for (const { box } of boxes) {
      const a = toPdf(box.left, box.top);
      const b = toPdf(box.right, box.bottom);
      page.drawRectangle({ x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y, borderColor: color, borderWidth: 0.35 });
    }
  }

  // 2. Fills.
  for (const { box } of boxes) {
    const cell = cellAt(box.anchor.r, box.anchor.c);
    const fill = styleOf(styles, cell?.style ?? 0).fill;
    if (!cell || !fill) continue;
    const a = toPdf(box.left, box.top);
    const b = toPdf(box.right, box.bottom);
    page.drawRectangle({ x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y, color: rgbOf(lib, fill) });
  }

  // 3. Borders.
  const edge = (e: { style: string; color: string } | undefined, x1: number, y1: number, x2: number, y2: number) => {
    if (!e) return;
    const w = (BORDER_WIDTH[e.style] ?? 0.5) * Math.max(0.6, scale);
    const color = rgbOf(lib, e.color);
    const p = toPdf(x1, y1);
    const q = toPdf(x2, y2);
    if (e.style === 'double') {
      const dx = y1 === y2 ? 0 : 0.9;
      const dy = y1 === y2 ? 0.9 : 0;
      page.drawLine({ start: { x: p.x - dx, y: p.y + dy }, end: { x: q.x - dx, y: q.y + dy }, thickness: w, color });
      page.drawLine({ start: { x: p.x + dx, y: p.y - dy }, end: { x: q.x + dx, y: q.y - dy }, thickness: w, color });
      return;
    }
    page.drawLine({ start: p, end: q, thickness: w, color, dashArray: BORDER_DASH[e.style] });
  };
  for (const { box } of boxes) {
    // A merged area takes each edge from the cells along it; the first cell's style is the usual case.
    const cell = cellAt(box.anchor.r, box.anchor.c);
    const b = styleOf(styles, cell?.style ?? 0).border;
    const rightCell = box.merge ? cellAt(box.anchor.r, box.merge.c2) : undefined;
    const bottomCell = box.merge ? cellAt(box.merge.r2, box.anchor.c) : undefined;
    edge(b.top, box.left, box.top, box.right, box.top);
    edge(b.left, box.left, box.top, box.left, box.bottom);
    edge((rightCell ? styleOf(styles, rightCell.style).border.right : undefined) ?? b.right, box.right, box.top, box.right, box.bottom);
    edge((bottomCell ? styleOf(styles, bottomCell.style).border.bottom : undefined) ?? b.bottom, box.left, box.bottom, box.right, box.bottom);
  }

  // 4. Text.
  for (const { r, c, box } of boxes) {
    const cell = cellAt(box.anchor.r, box.anchor.c);
    if (!cell || !cell.text) continue;
    const st = styleOf(styles, cell.style);
    let ts = textStyle(st, cell.color, scale);
    const indent = st.indent * 9;
    const width = box.right - box.left - PAD * 2 - indent;
    const height = box.bottom - box.top;
    const align =
      st.hAlign === 'general'
        ? cell.kind === 'number'
          ? 'right'
          : cell.kind === 'bool' || cell.kind === 'error'
            ? 'center'
            : 'left'
        : st.hAlign === 'centerContinuous' || st.hAlign === 'distributed'
          ? 'center'
          : st.hAlign === 'fill' || st.hAlign === 'justify'
            ? 'left'
            : st.hAlign;

    let lines: string[];
    let clipLeft = box.left;
    let clipRight = box.right;
    if (st.wrap || st.hAlign === 'justify' || st.vAlign === 'justify') {
      lines = painter.wrap(cell.text, Math.max(1, width * scale), ts);
    } else {
      const one = cell.text.replace(/[\r\n]+/g, ' ');
      let textWidth = painter.measure(one, ts) / scale;
      if (textWidth > width && st.shrink) {
        ts = { ...ts, size: Math.max(1, ts.size * (width / textWidth)) };
        textWidth = width;
      }
      lines = [one];
      if (textWidth > width) {
        if (cell.kind === 'number') {
          // A number that does not fit shows as ####, as in Excel, rather than a misleading part of it.
          const hash = painter.measure('#', ts) / scale;
          lines = ['#'.repeat(Math.max(1, Math.floor(width / Math.max(0.1, hash))))];
        } else if (!box.merge) {
          // Text spills into empty neighbouring cells on the side it is aligned away from.
          const spill = (dir: 1 | -1) => {
            let edgeX = dir > 0 ? box.right : box.left;
            let cc = c;
            for (;;) {
              const i = cols.indexOf(cc) + dir;
              const next = cols[i];
              if (next === undefined || cellAt(r, next)?.text || merges.has(`${r}:${next}`)) break;
              cc = next;
              edgeX = dir > 0 ? x.get(next)! + geo.colW.get(next)! : x.get(next)!;
              if (Math.abs(edgeX - (dir > 0 ? box.left : box.right)) >= textWidth + PAD * 2 + indent) break;
            }
            return edgeX;
          };
          if (align === 'left') clipRight = spill(1);
          else if (align === 'right') clipLeft = spill(-1);
          else {
            clipRight = spill(1);
            clipLeft = spill(-1);
          }
        }
      }
    }

    const lineH = ts.size / scale * 1.22;
    const blockH = lines.length * lineH;
    const top =
      st.vAlign === 'top'
        ? box.top + PAD * 0.5
        : st.vAlign === 'center' || st.vAlign === 'distributed' || st.vAlign === 'justify'
          ? box.top + (height - blockH) / 2
          : box.bottom - blockH - PAD * 0.4;

    const a = toPdf(clipLeft, box.top);
    const b = toPdf(clipRight, box.bottom);
    page.pushOperators(pushGraphicsState(), rectangle(a.x, b.y, b.x - a.x, a.y - b.y), clip(), endPath());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const w = painter.measure(line, ts) / scale;
      const left = clipLeft + PAD + (align === 'left' ? indent : 0);
      const right = clipRight - PAD - (align === 'right' ? indent : 0);
      const lx = align === 'right' ? right - w : align === 'center' ? (clipLeft + clipRight) / 2 - w / 2 : left;
      const baseline = top + i * lineH + (ts.size / scale) * 0.95;
      const p = toPdf(lx, baseline);
      await painter.draw(page, line, p.x, p.y, ts);
    }
    page.pushOperators(popGraphicsState());
  }

  // 5. Pictures, above the cells, where their anchors fall on this page.
  const pageLeft = 0;
  const pageRight = cx;
  const pageBottom = cy;
  const posX = (col: number, off: number) => {
    // Columns before this page's first column sit to its left; positions are measured along the sheet.
    const base = geo.colX.get(col) ?? 0;
    return base - (geo.colX.get(cols[0]) ?? 0) + off;
  };
  // Repeated title rows sit at the top of the page but are not where the page's own rows start;
  // pictures are placed relative to the first of the page's own rows.
  const bodyStart = rows.find((r) => !titleRows.has(r)) ?? rows[0];
  const posY = (row: number, off: number) => {
    const at = y.get(row);
    if (at !== undefined && !titleRows.has(row)) return at + off;
    return (y.get(bodyStart) ?? 0) + (geo.rowY.get(row) ?? 0) - (geo.rowY.get(bodyStart) ?? 0) + off;
  };
  for (const img of sheet.images) {
    const left = posX(img.from.col, img.from.colOff);
    const top = posY(img.from.row, img.from.rowOff);
    const right = img.to ? posX(img.to.col, img.to.colOff) : left + (img.width ?? 100);
    const bottom = img.to ? posY(img.to.row, img.to.rowOff) : top + (img.height ?? 100);
    if (right <= pageLeft || left >= pageRight || bottom <= 0 || top >= pageBottom || right - left < 1 || bottom - top < 1) continue;
    const embedded = img.mime === 'image/png' ? await page.doc.embedPng(img.data) : await page.doc.embedJpg(img.data);
    const a = toPdf(left, top);
    const b = toPdf(right, bottom);
    const c0 = toPdf(pageLeft, 0);
    const c1 = toPdf(pageRight, pageBottom);
    page.pushOperators(pushGraphicsState(), rectangle(c0.x, c1.y, c1.x - c0.x, c0.y - c1.y), clip(), endPath());
    page.drawImage(embedded, { x: a.x, y: b.y, width: b.x - a.x, height: a.y - b.y });
    page.pushOperators(popGraphicsState());
  }
}
