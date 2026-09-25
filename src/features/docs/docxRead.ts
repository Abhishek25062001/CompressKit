import { strFromU8, unzipSync } from 'fflate';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';
import {
  A4,
  STYLE_METRICS,
  type Align,
  type Block,
  type FontFamily,
  type ImageRun,
  type PageSetup,
  type Paragraph,
  type ParagraphStyle,
  type Run,
  type Table,
  type TableCell,
  type TextRun,
} from './model';

/**
 * Reads a Word document (.docx) into the shared document model. A .docx is a ZIP of XML parts:
 * word/document.xml holds the text, styles.xml the named styles, numbering.xml the list formats and
 * the relationships file points at pictures and links.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export class DocxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxReadError';
  }
}

export interface ReadResult {
  doc: import('./model').DocModel;
  /** Parts of the file that could not be carried over, in words for a notice. */
  warnings: string[];
}

type RunProps = Omit<TextRun, 'type' | 'text' | 'link'>;

interface StyleDef {
  basedOn?: string;
  paragraphStyle?: ParagraphStyle;
  align?: Align;
  run: RunProps;
  numbering?: { numId: string; level: number };
}

// ---------------------------------------------------------------------------------------------
// XML helpers. Word writes every element and attribute in the "w:" namespace.

const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
const val = (el: Element | null | undefined, name = 'val'): string | null =>
  el ? (el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`)) : null;
/** An on/off property such as <w:b/>: on unless its value says otherwise. */
const onOff = (el: Element | undefined): boolean | undefined => {
  if (!el) return undefined;
  const v = val(el);
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
};

function parseXml(files: Record<string, Uint8Array>, path: string): Document | null {
  const bytes = files[path];
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff',
};

function fontFamily(name: string | null): FontFamily | undefined {
  if (!name) return undefined;
  if (/courier|consol|mono|menlo|code|lucida console/i.test(name)) return 'mono';
  if (/sans/i.test(name)) return 'sans';
  if (/times|georgia|garamond|cambria|serif|book|palatino|minion|baskerville|didot|bodoni/i.test(name)) return 'serif';
  return 'sans';
}

const hex = (v: string | null): string | undefined => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : undefined);

function readRunProps(rPr: Element | undefined): RunProps {
  if (!rPr) return {};
  const props: RunProps = {};
  const bold = onOff(kid(rPr, 'b'));
  const italic = onOff(kid(rPr, 'i'));
  const underline = kid(rPr, 'u');
  const strike = onOff(kid(rPr, 'strike')) ?? onOff(kid(rPr, 'dstrike'));
  if (bold !== undefined) props.bold = bold;
  if (italic !== undefined) props.italic = italic;
  if (underline) props.underline = val(underline) !== 'none';
  if (strike !== undefined) props.strike = strike;
  const size = Number(val(kid(rPr, 'sz')));
  if (size > 0) props.size = size / 2;
  const color = hex(val(kid(rPr, 'color')));
  if (color) props.color = color;
  const highlight = HIGHLIGHTS[val(kid(rPr, 'highlight')) ?? ''] ?? hex(val(kid(rPr, 'shd'), 'fill'));
  if (highlight) props.highlight = highlight;
  const fonts = kid(rPr, 'rFonts');
  const font = fontFamily(val(fonts, 'ascii') ?? val(fonts, 'hAnsi'));
  if (font) props.font = font;
  return props;
}

function readAlign(pPr: Element | undefined): Align | undefined {
  const v = val(kid(pPr, 'jc'));
  if (!v) return undefined;
  if (v === 'center') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'both' || v === 'distribute') return 'justify';
  return 'left';
}

/** Headings are recognised by style name, since style ids are translated in non-English Word. */
function headingOf(name: string, outline: string | null): ParagraphStyle | undefined {
  const n = name.toLowerCase();
  if (n === 'title') return 'title';
  if (/quote/.test(n)) return 'quote';
  const m = /^heading\s*(\d)/.exec(n);
  const level = m ? Number(m[1]) : outline !== null ? Number(outline) + 1 : 0;
  if (level === 1) return 'h1';
  if (level === 2) return 'h2';
  if (level >= 3 && level <= 9) return 'h3';
  return undefined;
}

function readStyles(files: Record<string, Uint8Array>): { styles: Map<string, StyleDef>; defaults: RunProps } {
  const styles = new Map<string, StyleDef>();
  const xml = parseXml(files, 'word/styles.xml');
  if (!xml) return { styles, defaults: {} };
  const root = xml.documentElement;
  const defaults = readRunProps(kid(kid(kid(root, 'docDefaults'), 'rPrDefault'), 'rPr'));
  for (const s of kids(root, 'style')) {
    const id = val(s, 'styleId');
    if (!id) continue;
    const pPr = kid(s, 'pPr');
    const numPr = kid(pPr, 'numPr');
    const numId = val(kid(numPr, 'numId'));
    styles.set(id, {
      basedOn: val(kid(s, 'basedOn')) ?? undefined,
      paragraphStyle: headingOf(val(kid(s, 'name')) ?? id, val(kid(pPr, 'outlineLvl'))),
      align: readAlign(pPr),
      run: readRunProps(kid(s, 'rPr')),
      numbering: numId ? { numId, level: Number(val(kid(numPr, 'ilvl')) ?? 0) } : undefined,
    });
  }
  return { styles, defaults };
}

/** A style with everything it inherits through "based on". */
function resolveStyle(styles: Map<string, StyleDef>, id: string | null | undefined): StyleDef {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let current = id ?? undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    const s = styles.get(current);
    if (!s) break;
    chain.unshift(s);
    current = s.basedOn;
  }
  const out: StyleDef = { run: {} };
  for (const s of chain) {
    out.paragraphStyle = s.paragraphStyle ?? out.paragraphStyle;
    out.align = s.align ?? out.align;
    out.numbering = s.numbering ?? out.numbering;
    out.run = { ...out.run, ...s.run };
  }
  return out;
}

/** Which lists are numbered: numId → level → ordered. Everything else shows as bullets. */
function readNumbering(files: Record<string, Uint8Array>): (numId: string, level: number) => boolean {
  const xml = parseXml(files, 'word/numbering.xml');
  if (!xml) return () => false;
  const abstract = new Map<string, Map<number, boolean>>();
  for (const a of kids(xml.documentElement, 'abstractNum')) {
    const levels = new Map<number, boolean>();
    for (const lvl of kids(a, 'lvl')) {
      const fmt = val(kid(lvl, 'numFmt')) ?? 'bullet';
      levels.set(Number(val(lvl, 'ilvl') ?? 0), fmt !== 'bullet' && fmt !== 'none');
    }
    abstract.set(val(a, 'abstractNumId') ?? '', levels);
  }
  const nums = new Map<string, string>();
  for (const n of kids(xml.documentElement, 'num')) nums.set(val(n, 'numId') ?? '', val(kid(n, 'abstractNumId')) ?? '');
  return (numId, level) => abstract.get(nums.get(numId) ?? '')?.get(level) ?? false;
}

function readRelationships(files: Record<string, Uint8Array>): Map<string, { target: string; external: boolean }> {
  const rels = new Map<string, { target: string; external: boolean }>();
  const xml = parseXml(files, 'word/_rels/document.xml.rels');
  if (!xml) return rels;
  for (const r of Array.from(xml.getElementsByTagName('Relationship'))) {
    rels.set(r.getAttribute('Id') ?? '', {
      target: r.getAttribute('Target') ?? '',
      external: r.getAttribute('TargetMode') === 'External',
    });
  }
  return rels;
}

/** Resolves "media/image1.png" or "/word/media/image1.png" against the word/ folder. */
function partPath(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['word', ...target.split('/')];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

const EMU_PER_POINT = 12700;

/** PNG and JPEG go into PDFs as they are; GIF, BMP and WebP are redrawn as PNG. Vector formats are skipped. */
async function imageRun(bytes: Uint8Array, path: string, width: number, height: number): Promise<ImageRun | null> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return { type: 'image', data: bytes, mime: 'image/png', width, height };
  if (ext === 'jpg' || ext === 'jpeg') return { type: 'image', data: bytes, mime: 'image/jpeg', width, height };
  if (!['gif', 'bmp', 'webp', 'tif', 'tiff'].includes(ext)) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = createCanvas(bitmap.width, bitmap.height);
    getContext(canvas).drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    releaseCanvas(canvas);
    return { type: 'image', data: png, mime: 'image/png', width, height };
  } catch {
    return null;
  }
}

/** Reads a .docx file. Throws DocxReadError when the file is not a Word document. */
export async function readDocx(file: Blob): Promise<ReadResult> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new DocxReadError('not-zip');
  }
  const xml = parseXml(files, 'word/document.xml');
  if (!xml) throw new DocxReadError('no-document');

  const { styles, defaults } = readStyles(files);
  const isOrdered = readNumbering(files);
  const rels = readRelationships(files);
  const warnings = new Set<string>();
  const body = kid(xml.documentElement, 'body');
  const blocks: Block[] = [];
  let page: PageSetup = A4;

  /** Collects the runs of one paragraph, splitting it where Word has a page break inside. */
  async function readParagraph(p: Element, out: Block[]): Promise<void> {
    const pPr = kid(p, 'pPr');
    const styleId = val(kid(pPr, 'pStyle'));
    const style = resolveStyle(styles, styleId ?? 'Normal');
    const numPr = kid(pPr, 'numPr');
    const numId = val(kid(numPr, 'numId')) ?? style.numbering?.numId;
    const level = Number(val(kid(numPr, 'ilvl')) ?? style.numbering?.level ?? 0);
    const base: Omit<Paragraph, 'runs'> = {
      type: 'paragraph',
      style: style.paragraphStyle ?? 'normal',
      align: readAlign(pPr) ?? style.align ?? 'left',
      list: numId && numId !== '0' ? { ordered: isOrdered(numId, level), level: Math.min(level, 4) } : undefined,
    };
    const paragraphRun = { ...defaults, ...style.run };
    // Heading sizes come from our own styles, so only an explicit size in the paragraph changes them.
    if (base.style !== 'normal') delete paragraphRun.size;
    if (onOff(kid(pPr, 'pageBreakBefore'))) out.push({ type: 'pagebreak' });

    let runs: Run[] = [];
    const flush = (force = false) => {
      if (runs.length || force) out.push({ ...base, runs });
      runs = [];
    };

    const readRun = async (r: Element, link?: string) => {
      const rPr = kid(r, 'rPr');
      const charStyle = resolveStyle(styles, val(kid(rPr, 'rStyle')));
      const props: RunProps = { ...paragraphRun, ...charStyle.run, ...readRunProps(rPr) };
      // The usual look (sans serif, 11 pt body text) is left implicit, so edited and rewritten
      // documents do not carry it on every word.
      if (props.font === 'sans') delete props.font;
      if (props.size === STYLE_METRICS[base.style].size) delete props.size;
      // Hidden text stays hidden.
      if (onOff(kid(rPr, 'vanish'))) return;
      for (const c of kids(r)) {
        switch (c.localName) {
          case 't':
          case 'delText':
            if (c.localName === 't' && c.textContent) runs.push({ type: 'text', text: c.textContent, ...props, ...(link ? { link } : {}) });
            break;
          case 'tab':
            runs.push({ type: 'text', text: '\t', ...props });
            break;
          case 'noBreakHyphen':
            runs.push({ type: 'text', text: '-', ...props });
            break;
          case 'br':
          case 'cr':
            if (val(c, 'type') === 'page') {
              flush();
              out.push({ type: 'pagebreak' });
            } else runs.push({ type: 'break' });
            break;
          case 'drawing':
          case 'pict':
          case 'object': {
            const blip = c.getElementsByTagNameNS('*', 'blip')[0] ?? c.getElementsByTagNameNS('*', 'imagedata')[0];
            const id = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttributeNS(R, 'id') ?? blip?.getAttribute('r:embed') ?? blip?.getAttribute('r:id');
            const rel = id ? rels.get(id) : undefined;
            if (!rel || rel.external) {
              if (c.localName !== 'pict' || !c.getElementsByTagNameNS('*', 'textbox').length) warnings.add('shapes or charts');
              // Text boxes: keep their words as normal paragraphs.
              for (const tp of Array.from(c.getElementsByTagNameNS(W, 'p'))) await readParagraph(tp, out);
              break;
            }
            const extent = c.getElementsByTagNameNS('*', 'extent')[0];
            let width = Number(extent?.getAttribute('cx')) / EMU_PER_POINT;
            let height = Number(extent?.getAttribute('cy')) / EMU_PER_POINT;
            if (!(width > 0 && height > 0)) {
              // Legacy VML pictures give their size in CSS, e.g. "width:120pt;height:80pt".
              const css = c.getElementsByTagNameNS('*', 'shape')[0]?.getAttribute('style') ?? '';
              width = parseFloat(/width:([\d.]+)pt/.exec(css)?.[1] ?? '200');
              height = parseFloat(/height:([\d.]+)pt/.exec(css)?.[1] ?? '150');
            }
            const path = partPath(rel.target);
            const bytes = files[path];
            const image = bytes ? await imageRun(bytes, path, width, height) : null;
            if (image) runs.push(image);
            else warnings.add('pictures in formats other than PNG, JPG, GIF or BMP');
            break;
          }
          default:
            break;
        }
      }
    };

    const readInline = async (el: Element, link?: string): Promise<void> => {
      for (const c of kids(el)) {
        switch (c.localName) {
          case 'r':
            await readRun(c, link);
            break;
          case 'hyperlink': {
            const rel = rels.get(c.getAttributeNS(R, 'id') ?? c.getAttribute('r:id') ?? '');
            await readInline(c, rel?.external ? rel.target : link);
            break;
          }
          // Tracked insertions count as text; deletions do not.
          case 'ins':
          case 'smartTag':
          case 'fldSimple':
          case 'customXml':
          case 'bdo':
          case 'dir':
            await readInline(c, link);
            break;
          case 'sdt':
            await readInline(kid(c, 'sdtContent') ?? c, link);
            break;
          case 'oMath':
          case 'oMathPara':
            warnings.add('equations');
            runs.push({ type: 'text', text: c.textContent ?? '', ...paragraphRun, italic: true });
            break;
          default:
            break;
        }
      }
    };

    await readInline(p);
    // An empty paragraph is a blank line, which documents use for spacing; but one left over right
    // after a page break would only push the next page's text down, so it is dropped.
    if (runs.length || out[out.length - 1]?.type !== 'pagebreak') flush(true);
  }

  async function readTable(tbl: Element): Promise<Table> {
    const rows: TableCell[][] = [];
    for (const tr of kids(tbl, 'tr')) {
      const row: TableCell[] = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = Number(val(kid(tcPr, 'gridSpan')) ?? 1);
        const merged = kid(tcPr, 'vMerge');
        const continued = merged && val(merged) !== 'restart';
        const inner: Block[] = [];
        if (!continued) await readBlocks(tc, inner);
        // Nested tables become their cells' paragraphs, one after another.
        const paragraphs: Paragraph[] = [];
        const collect = (list: Block[]) => {
          for (const b of list) {
            if (b.type === 'paragraph') paragraphs.push(b);
            else if (b.type === 'table') b.rows.forEach((r) => r.forEach((cell) => paragraphs.push(...cell.paragraphs)));
          }
        };
        collect(inner);
        row.push({ paragraphs, span: span > 1 ? span : undefined, shade: hex(val(kid(tcPr, 'shd'), 'fill')) });
      }
      if (row.length) rows.push(row);
    }
    return { type: 'table', rows };
  }

  async function readBlocks(parent: Element, out: Block[]): Promise<void> {
    for (const c of kids(parent)) {
      if (c.localName === 'p') await readParagraph(c, out);
      else if (c.localName === 'tbl') out.push(await readTable(c));
      else if (c.localName === 'sdt') await readBlocks(kid(c, 'sdtContent') ?? c, out);
      else if (c.localName === 'customXml' || c.localName === 'ins') await readBlocks(c, out);
      else if (c.localName === 'altChunk') warnings.add('embedded web or RTF content');
    }
  }

  await readBlocks(body!, blocks);

  // Page size of the last section, which Word stores at the end of the body.
  const sectPr = kid(body, 'sectPr');
  const size = kid(sectPr, 'pgSz');
  const margins = kid(sectPr, 'pgMar');
  const twips = (el: Element | undefined, name: string, fallback: number) => {
    const n = Number(val(el, name));
    return Number.isFinite(n) && n > 0 ? n / 20 : fallback;
  };
  if (size) {
    page = {
      width: twips(size, 'w', A4.width),
      height: twips(size, 'h', A4.height),
      margin: {
        top: twips(margins, 'top', 72),
        right: twips(margins, 'right', 72),
        bottom: twips(margins, 'bottom', 72),
        left: twips(margins, 'left', 72),
      },
    };
  }
  if (files['word/header1.xml'] || files['word/footer1.xml']) warnings.add('headers and footers');
  if (files['word/footnotes.xml'] && /<w:footnote [^>]*w:id="[1-9]/.test(strFromU8(files['word/footnotes.xml']))) warnings.add('footnotes');

  // Drop trailing empty paragraphs, which would otherwise add a blank last page.
  while (blocks.length) {
    const last = blocks[blocks.length - 1];
    if ((last.type === 'paragraph' && !last.runs.length) || last.type === 'pagebreak') blocks.pop();
    else break;
  }

  return { doc: { page, blocks }, warnings: [...warnings] };
}

export function isDocx(file: File): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(file.name)
  );
}
