import { strFromU8, unzipSync } from 'fflate';
import { builtinFormat, formatValue } from './numFmt';

/**
 * Reads Excel workbooks (.xlsx, .xlsm) and CSV files into a sheet model for printing: every cell's
 * value shown as Excel formats it, with its font, fill, borders and alignment; column widths and
 * row heights; merged, hidden and print-area settings; and pictures placed on the sheet.
 */

export class XlsxReadError extends Error {}

export interface BorderEdge {
  style: string;
  color: string;
}

export interface CellStyle {
  font: { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string };
  fill?: string;
  border: { top?: BorderEdge; right?: BorderEdge; bottom?: BorderEdge; left?: BorderEdge };
  hAlign: 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed';
  vAlign: 'top' | 'center' | 'bottom' | 'justify' | 'distributed';
  wrap: boolean;
  shrink: boolean;
  indent: number;
  numFmt: string;
}

export interface Cell {
  /** The text Excel shows. */
  text: string;
  kind: 'number' | 'text' | 'bool' | 'error' | 'empty';
  style: number;
  /** A colour from the number format, such as [Red] for negatives. */
  color?: string;
}

export interface SheetImage {
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Anchor: zero-based column and row, with offsets in points inside them. */
  from: { col: number; colOff: number; row: number; rowOff: number };
  to?: { col: number; colOff: number; row: number; rowOff: number };
  /** Size in points, for pictures anchored at one corner only. */
  width?: number;
  height?: number;
}

export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface Sheet {
  name: string;
  /** Cells by row, then column, zero-based. */
  rows: Map<number, Map<number, Cell>>;
  /** Column widths in points; missing columns use `defaultColWidth`. */
  colWidths: Map<number, number>;
  hiddenCols: Set<number>;
  /** Row heights in points; missing rows use `defaultRowHeight`. */
  rowHeights: Map<number, number>;
  hiddenRows: Set<number>;
  defaultColWidth: number;
  defaultRowHeight: number;
  merges: Range[];
  printArea?: Range;
  /** Rows repeated at the top of every page. */
  titleRows?: { r1: number; r2: number };
  landscape?: boolean;
  /** Fit to this many pages wide (0 = no limit), when the sheet asks to fit to page. */
  fitToWidth?: number;
  showGrid: boolean;
  images: SheetImage[];
  charts: number;
}

export interface Workbook {
  sheets: Sheet[];
  styles: CellStyle[];
  warnings: string[];
}

const DEFAULT_STYLE: CellStyle = {
  font: { name: 'Calibri', size: 11, bold: false, italic: false, underline: false, strike: false, color: '#000000' },
  border: {},
  hAlign: 'general',
  vAlign: 'bottom',
  wrap: false,
  shrink: false,
  indent: 0,
  numFmt: 'General',
};

/** Excel's legacy palette, for colours given by index. */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** Column letters to a zero-based index: "A" → 0, "AB" → 27. */
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" → { row: 2, col: 1 }. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null;
}

function parseRange(ref: string): Range | null {
  const [a, b = a] = ref.split(':');
  const p = parseRef(a);
  const q = parseRef(b);
  if (!p || !q) return null;
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
}

// ---------------------------------------------------------------------------------------------
// Colours.

function hslTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const n = parseInt(hex, 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `${to(r)}${to(g)}${to(b)}`;
}

function readColor(el: Element | null | undefined, theme: string[], fallback?: string): string | undefined {
  if (!el) return fallback;
  if (el.getAttribute('auto') === '1') return fallback;
  const tint = Number(el.getAttribute('tint') ?? 0);
  const rgb = el.getAttribute('rgb');
  if (rgb) return `#${hslTint(rgb.slice(-6), tint).toLowerCase()}`;
  const t = el.getAttribute('theme');
  if (t !== null) {
    const base = theme[Number(t)];
    return base ? `#${hslTint(base, tint).toLowerCase()}` : fallback;
  }
  const i = el.getAttribute('indexed');
  if (i !== null) {
    const idx = Number(i);
    if (idx === 64) return fallback;
    const base = INDEXED[idx];
    return base ? `#${hslTint(base, tint).toLowerCase()}` : fallback;
  }
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// XML helpers that ignore namespace prefixes ("x:c" and "c" are the same element).

const all = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name));
const first = (el: Element | Document, name: string) => el.getElementsByTagNameNS('*', name)[0] as Element | undefined;
const children = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const child = (el: Element | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);

function textOf(el: Element): string {
  // Rich text keeps its runs' text; phonetic guides (<rPh>) are not shown.
  let out = '';
  for (const n of Array.from(el.children)) {
    if (n.localName === 't') out += n.textContent ?? '';
    else if (n.localName === 'r') out += first(n, 't')?.textContent ?? '';
  }
  return out.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------------------------------------------------------------------------------------------

type Files = Record<string, Uint8Array>;

function parse(files: Files, path: string): Document | null {
  const data = files[path];
  if (!data) return null;
  return new DOMParser().parseFromString(strFromU8(data), 'application/xml');
}

function relsOf(files: Files, part: string): Map<string, { target: string; type: string }> {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const name = part.slice(part.lastIndexOf('/') + 1);
  const doc = parse(files, `${dir}_rels/${name}.rels`);
  const map = new Map<string, { target: string; type: string }>();
  if (!doc) return map;
  for (const r of all(doc, 'Relationship')) {
    const target = r.getAttribute('Target') ?? '';
    if (r.getAttribute('TargetMode') === 'External') continue;
    map.set(r.getAttribute('Id') ?? '', { target: resolve(dir, target), type: r.getAttribute('Type') ?? '' });
  }
  return map;
}

function resolve(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

function readTheme(files: Files, wbPath: string): string[] {
  const rels = relsOf(files, wbPath);
  const themePath = [...rels.values()].find((r) => r.type.endsWith('/theme'))?.target ?? 'xl/theme/theme1.xml';
  const doc = parse(files, themePath);
  const fallback = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
  if (!doc) return fallback;
  const scheme = first(doc, 'clrScheme');
  if (!scheme) return fallback;
  const value = (name: string) => {
    const el = child(scheme, name);
    const c = el?.firstElementChild;
    return c?.getAttribute('lastClr') ?? c?.getAttribute('val') ?? '000000';
  };
  // Excel's theme indexes swap the first two pairs: 0 is light 1 (background), 1 is dark 1 (text).
  return [value('lt1'), value('dk1'), value('lt2'), value('dk2'), ...['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(value)];
}

function readStyles(files: Files, path: string | undefined, theme: string[]): CellStyle[] {
  const doc = path ? parse(files, path) : null;
  if (!doc) return [DEFAULT_STYLE];
  const numFmts = new Map<number, string>();
  for (const f of all(doc, 'numFmt')) numFmts.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General');
  const fontsEl = first(doc, 'fonts');
  const fonts = fontsEl
    ? children(fontsEl, 'font').map((f) => {
        const val = (name: string) => child(f, name);
        const flag = (name: string) => {
          const el = val(name);
          return !!el && el.getAttribute('val') !== '0' && el.getAttribute('val') !== 'false';
        };
        const u = val('u');
        return {
          name: val('name')?.getAttribute('val') ?? 'Calibri',
          size: Number(val('sz')?.getAttribute('val') ?? 11),
          bold: flag('b'),
          italic: flag('i'),
          underline: !!u && u.getAttribute('val') !== 'none',
          strike: flag('strike'),
          color: readColor(val('color'), theme, '#000000')!,
        };
      })
    : [DEFAULT_STYLE.font];
  const fillsEl = first(doc, 'fills');
  const fills = fillsEl
    ? children(fillsEl, 'fill').map((f) => {
        const pattern = child(f, 'patternFill');
        if (pattern) {
          const type = pattern.getAttribute('patternType') ?? 'none';
          if (type === 'none') return undefined;
          // Solid fills use the foreground colour; other patterns are drawn as a solid tint of it.
          return readColor(child(pattern, 'fgColor'), theme) ?? readColor(child(pattern, 'bgColor'), theme);
        }
        const gradient = child(f, 'gradientFill');
        const stop = gradient ? child(gradient, 'stop') : undefined;
        return readColor(child(stop, 'color'), theme);
      })
    : [];
  const bordersEl = first(doc, 'borders');
  const borders = bordersEl
    ? children(bordersEl, 'border').map((b) => {
        const edge = (name: string): BorderEdge | undefined => {
          const el = child(b, name);
          const style = el?.getAttribute('style');
          if (!el || !style || style === 'none') return undefined;
          return { style, color: readColor(child(el, 'color'), theme, '#000000')! };
        };
        return { top: edge('top'), right: edge('right'), bottom: edge('bottom'), left: edge('left') ?? edge('start') };
      })
    : [];
  const xfsEl = first(doc, 'cellXfs');
  if (!xfsEl) return [DEFAULT_STYLE];
  return children(xfsEl, 'xf').map((xf) => {
    const numId = Number(xf.getAttribute('numFmtId') ?? 0);
    const align = child(xf, 'alignment');
    const b = borders[Number(xf.getAttribute('borderId') ?? 0)] ?? {};
    return {
      font: fonts[Number(xf.getAttribute('fontId') ?? 0)] ?? DEFAULT_STYLE.font,
      fill: fills[Number(xf.getAttribute('fillId') ?? 0)],
      border: b,
      hAlign: (align?.getAttribute('horizontal') as CellStyle['hAlign']) ?? 'general',
      vAlign: (align?.getAttribute('vertical') as CellStyle['vAlign']) ?? 'bottom',
      wrap: align?.getAttribute('wrapText') === '1' || align?.getAttribute('wrapText') === 'true',
      shrink: align?.getAttribute('shrinkToFit') === '1',
      indent: Number(align?.getAttribute('indent') ?? 0),
      numFmt: numFmts.get(numId) ?? builtinFormat(numId),
    };
  });
}

/** Excel column width (in characters of the default font) to points. */
const widthToPt = (chars: number) => Math.max(0, Math.trunc(((256 * chars + Math.trunc(128 / 7)) / 256) * 7)) * 0.75;

const EMU_PER_PT = 12700;

function readDrawing(files: Files, path: string): { images: SheetImage[]; charts: number } {
  const doc = parse(files, path);
  const images: SheetImage[] = [];
  let charts = 0;
  if (!doc) return { images, charts };
  const rels = relsOf(files, path);
  const anchor = (el: Element | undefined) => {
    if (!el) return undefined;
    const num = (name: string) => Number(child(el, name)?.textContent ?? 0);
    return { col: num('col'), colOff: num('colOff') / EMU_PER_PT, row: num('row'), rowOff: num('rowOff') / EMU_PER_PT };
  };
  for (const a of [...all(doc, 'twoCellAnchor'), ...all(doc, 'oneCellAnchor'), ...all(doc, 'absoluteAnchor')]) {
    if (first(a, 'chart') || first(a, 'graphicFrame')) {
      charts++;
      continue;
    }
    const blip = first(a, 'blip');
    const rid = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? blip?.getAttribute('r:embed');
    const target = rid ? rels.get(rid)?.target : undefined;
    const data = target ? files[target] : undefined;
    if (!data) continue;
    const mime = data[0] === 0x89 ? 'image/png' : data[0] === 0xff ? 'image/jpeg' : null;
    if (!mime) continue;
    const from = anchor(child(a, 'from'));
    const to = anchor(child(a, 'to'));
    const ext = child(a, 'ext');
    if (from) {
      images.push({
        data,
        mime,
        from,
        to,
        width: ext ? Number(ext.getAttribute('cx')) / EMU_PER_PT : undefined,
        height: ext ? Number(ext.getAttribute('cy')) / EMU_PER_PT : undefined,
      });
    }
  }
  return { images, charts };
}

export function readXlsx(bytes: Uint8Array): Workbook {
  let files: Files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new XlsxReadError('not a zip');
  }
  const rootRels = relsOf(files, '');
  const wbPath = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
  const wb = parse(files, wbPath);
  if (!wb || !first(wb, 'sheets')) throw new XlsxReadError('no workbook');
  const wbRels = relsOf(files, wbPath);
  const theme = readTheme(files, wbPath);
  const stylesPath = [...wbRels.values()].find((r) => r.type.endsWith('/styles'))?.target;
  const styles = readStyles(files, stylesPath, theme);
  const date1904 = ['1', 'true'].includes(first(wb, 'workbookPr')?.getAttribute('date1904') ?? '');
  const sstPath = [...wbRels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
  const sstDoc = sstPath ? parse(files, sstPath) : null;
  const shared = sstDoc ? all(sstDoc, 'si').map(textOf) : [];
  const warnings = new Set<string>();

  // Print areas and titles are workbook-level names tied to a sheet.
  const defined = all(wb, 'definedName').map((d) => ({ name: d.getAttribute('name') ?? '', sheet: d.getAttribute('localSheetId'), value: d.textContent ?? '' }));

  const sheets: Sheet[] = [];
  all(wb, 'sheet').forEach((s, sheetIndex) => {
    if (s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden') return;
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? '';
    const rel = wbRels.get(rid);
    if (!rel || !/\/worksheet$/.test(rel.type)) return;
    const doc = parse(files, rel.target);
    if (!doc) return;
    const name = s.getAttribute('name') ?? `Sheet${sheetIndex + 1}`;

    const fmt = first(doc, 'sheetFormatPr');
    const defaultColWidth = fmt?.getAttribute('defaultColWidth')
      ? widthToPt(Number(fmt.getAttribute('defaultColWidth')))
      : widthToPt(Number(fmt?.getAttribute('baseColWidth') ?? 8) + 0.71);
    const defaultRowHeight = Number(fmt?.getAttribute('defaultRowHeight') ?? 15);

    const colWidths = new Map<number, number>();
    const hiddenCols = new Set<number>();
    for (const c of all(doc, 'col')) {
      const min = Number(c.getAttribute('min')) - 1;
      const max = Math.min(Number(c.getAttribute('max')) - 1, min + 16384);
      const width = c.getAttribute('width') ? widthToPt(Number(c.getAttribute('width'))) : defaultColWidth;
      const hidden = c.getAttribute('hidden') === '1' || c.getAttribute('hidden') === 'true';
      for (let i = min; i <= max && i < 16384; i++) {
        colWidths.set(i, width);
        if (hidden || width === 0) hiddenCols.add(i);
      }
    }

    const rows = new Map<number, Map<number, Cell>>();
    const rowHeights = new Map<number, number>();
    const hiddenRows = new Set<number>();
    let nextRow = 0;
    for (const row of all(doc, 'row')) {
      const r = row.getAttribute('r') ? Number(row.getAttribute('r')) - 1 : nextRow;
      nextRow = r + 1;
      if (row.getAttribute('ht')) rowHeights.set(r, Number(row.getAttribute('ht')));
      if (row.getAttribute('hidden') === '1' || row.getAttribute('hidden') === 'true') hiddenRows.add(r);
      const rowStyle = row.getAttribute('customFormat') === '1' ? Number(row.getAttribute('s') ?? 0) : 0;
      const cells = new Map<number, Cell>();
      let nextCol = 0;
      for (const c of children(row, 'c')) {
        const ref = c.getAttribute('r');
        const col = ref ? (parseRef(ref)?.col ?? nextCol) : nextCol;
        nextCol = col + 1;
        const style = Number(c.getAttribute('s') ?? rowStyle);
        const t = c.getAttribute('t') ?? 'n';
        const v = child(c, 'v')?.textContent ?? '';
        const st = styles[style] ?? DEFAULT_STYLE;
        let cell: Cell;
        if (t === 's') cell = { text: shared[Number(v)] ?? '', kind: 'text', style };
        else if (t === 'inlineStr') {
          const is = child(c, 'is');
          cell = { text: is ? textOf(is) : '', kind: 'text', style };
        } else if (t === 'str') cell = { text: v, kind: 'text', style };
        else if (t === 'b') cell = { text: v === '1' ? 'TRUE' : 'FALSE', kind: 'bool', style };
        else if (t === 'e') cell = { text: v, kind: 'error', style };
        else if (t === 'd') {
          const ms = Date.parse(v);
          const serial = Number.isNaN(ms) ? NaN : ms / 86400000 + 25569;
          cell = Number.isNaN(serial) ? { text: v, kind: 'text', style } : { ...formatValue(serial, st.numFmt === 'General' ? 'yyyy-mm-dd' : st.numFmt, date1904), kind: 'number', style };
        } else if (v === '') cell = { text: '', kind: 'empty', style };
        else {
          const f = formatValue(Number(v), st.numFmt, date1904);
          cell = { text: f.text, color: f.color, kind: 'number', style };
        }
        // Text cells with a text section in their format ("@" with extra words) show it.
        if (cell.kind === 'text' && st.numFmt.includes('@')) {
          const f = formatValue(cell.text, st.numFmt, date1904);
          cell = { ...cell, text: f.text, color: f.color };
        }
        cells.set(col, cell);
      }
      if (cells.size) rows.set(r, cells);
    }

    const merges = all(doc, 'mergeCell').flatMap((m) => {
      const range = parseRange(m.getAttribute('ref') ?? '');
      return range ? [range] : [];
    });

    const pageSetup = first(doc, 'pageSetup');
    const fitToPage = ['1', 'true'].includes(first(doc, 'pageSetUpPr')?.getAttribute('fitToPage') ?? '');
    const view = first(doc, 'sheetView');

    const sheet: Sheet = {
      name,
      rows,
      colWidths,
      hiddenCols,
      rowHeights,
      hiddenRows,
      defaultColWidth,
      defaultRowHeight,
      merges,
      landscape: pageSetup?.getAttribute('orientation') === 'landscape' ? true : pageSetup?.getAttribute('orientation') === 'portrait' ? false : undefined,
      fitToWidth: fitToPage ? Number(pageSetup?.getAttribute('fitToWidth') ?? 1) : undefined,
      showGrid: ['1', 'true'].includes(first(doc, 'printOptions')?.getAttribute('gridLines') ?? '') || view?.getAttribute('showGridLines') !== '0',
      images: [],
      charts: 0,
    };

    for (const d of defined.filter((x) => x.sheet === String(sheetIndex))) {
      const refs = d.value.split(',').map((part) => part.replace(/^.*!/, '').replace(/\$/g, ''));
      if (d.name === '_xlnm.Print_Area') {
        const range = parseRange(refs[0]);
        if (range) sheet.printArea = range;
      } else if (d.name === '_xlnm.Print_Titles') {
        const rowsRef = refs.find((r) => /^\d+:\d+$/.test(r));
        if (rowsRef) {
          const [a, b] = rowsRef.split(':').map((n) => Number(n) - 1);
          sheet.titleRows = { r1: a, r2: b };
        }
      }
    }

    const sheetRels = relsOf(files, rel.target);
    for (const dr of all(doc, 'drawing')) {
      const id = dr.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? dr.getAttribute('r:id') ?? '';
      const target = sheetRels.get(id)?.target;
      if (!target) continue;
      const { images, charts } = readDrawing(files, target);
      sheet.images.push(...images);
      sheet.charts += charts;
    }
    if (sheet.charts) warnings.add('charts');
    sheets.push(sheet);
  });
  if (!sheets.length) throw new XlsxReadError('no visible sheets');
  return { sheets, styles, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------------------------
// CSV.

/** Picks the delimiter that splits the first lines into the most consistent number of fields. */
function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).filter(Boolean);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((line) => line.split(d).length);
    if (Math.min(...counts) < 2) continue;
    const score = counts.filter((c) => c === counts[0]).length * counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Parses CSV with quoted fields, doubled quotes and line breaks inside quotes (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A CSV file as a one-sheet workbook; numbers are right-aligned like Excel shows them. */
export function csvToWorkbook(text: string, name: string): Workbook {
  const data = parseCsv(text.replace(/^\ufeff/, ''));
  const rows = new Map<number, Map<number, Cell>>();
  const widths = new Map<number, number>();
  data.forEach((fields, r) => {
    const cells = new Map<number, Cell>();
    fields.forEach((value, c) => {
      if (value === '') return;
      const numeric = /^-?\d{1,15}(\.\d+)?$/.test(value.trim());
      cells.set(c, { text: value, kind: numeric ? 'number' : 'text', style: r === 0 ? 1 : 0 });
      // Columns as wide as their longest value, within reason, like Excel's autofit.
      widths.set(c, Math.min(300, Math.max(widths.get(c) ?? 0, value.length * 5.6 + 8)));
    });
    if (cells.size) rows.set(r, cells);
  });
  const bold: CellStyle = { ...DEFAULT_STYLE, font: { ...DEFAULT_STYLE.font, bold: true } };
  return {
    sheets: [
      {
        name,
        rows,
        colWidths: new Map([...widths].map(([c, w]) => [c, Math.max(48, w)])),
        hiddenCols: new Set(),
        rowHeights: new Map(),
        hiddenRows: new Set(),
        defaultColWidth: 48,
        defaultRowHeight: 15,
        merges: [],
        titleRows: data.length > 1 ? { r1: 0, r2: 0 } : undefined,
        showGrid: true,
        images: [],
        charts: 0,
      },
    ],
    styles: [DEFAULT_STYLE, bold],
    warnings: [],
  };
}
