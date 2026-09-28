import { A4, type Align, type Block, type DocModel, type FontFamily, type ImageRun, type PageSetup, type Paragraph, type ParagraphStyle, type Run, type TableCell, type TextRun } from './model';

/**
 * Reads Rich Text Format (from Word, WordPad, TextEdit, LibreOffice and many older programs) into
 * the shared document model: text with its fonts, sizes, colours and styles, paragraph alignment,
 * headings, lists, tables, links, pictures and page breaks. Headers, footers, footnotes and drawing
 * shapes are left out, as they are for Word files.
 */

export class RtfReadError extends Error {}

export interface RtfResult {
  doc: DocModel;
  warnings: string[];
}

interface CharState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  hidden: boolean;
  /** Half-points. */
  fs: number;
  font: number;
  color: number;
  highlight: number;
  /** Characters to skip after \uN. */
  uc: number;
  link?: string;
}

interface ParaState {
  align: Align;
  style: number;
  inTable: boolean;
  outline: number | null;
  level: number;
  listed: boolean;
}

/** What a group does with its text. */
type Destination = 'text' | 'skip' | 'fonttbl' | 'colortbl' | 'stylesheet' | 'pict' | 'fldinst' | 'listtext';

interface Group {
  char: CharState;
  /** Paragraph properties are saved with groups too, and restored when one closes. */
  para?: ParaState;
  dest: Destination;
  /** Group depth of the field this group belongs to, for its link. */
  field?: { url?: string };
}

/** Windows code pages for \fcharset values. */
const CHARSET_CODEPAGE: Record<number, string> = {
  0: 'windows-1252',
  2: 'windows-1252',
  77: 'macintosh',
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

const ANSICPG: Record<number, string> = {
  437: 'ibm866',
  850: 'windows-1252',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  10000: 'macintosh',
};

/** Groups whose content is never shown. */
const SKIPPED = new Set([
  'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation', 'atnid',
  'atnauthor', 'object', 'objdata', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable',
  'listoverridetable', 'rsidtbl', 'generator', 'mmathPr', 'pgdsctbl', 'revtbl', 'filetbl', 'nonshppict', 'bkmkstart', 'bkmkend',
  'pn', 'pnseclvl', 'shpinst', 'template', 'userprops', 'xmlopen', 'xmlclose', 'wgrffmtfilter', 'fchars', 'lchars', 'factoidname',
  'docvar', 'ftnsep', 'ftnsepc', 'ftncn', 'aftnsep', 'aftnsepc', 'aftncn', 'stylesheet_ignored', 'passwordhash', 'protusertbl',
  'blipuid', 'formfield', 'datafield', 'falt', 'panose', 'fname', 'expandedcolortbl', 'listpicture', 'hl', 'txe', 'comment',
]);

const SYMBOLS: Record<string, string> = {
  emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
  emspace: ' ', enspace: ' ', qmspace: ' ', zwj: '‍', zwnj: '‌', ltrmark: '', rtlmark: '',
};

function familyFor(kind: string, name: string): FontFamily {
  if (/courier|mono|consol|menlo|lucida console/i.test(name) || kind === 'fmodern') return 'mono';
  if (/times|georgia|garamond|cambria|palatino|book|serif/i.test(name) && !/sans/i.test(name)) return 'serif';
  if (kind === 'froman') return 'serif';
  return 'sans';
}

function headingFor(name: string): ParagraphStyle | undefined {
  const n = name.trim().toLowerCase();
  if (n === 'title') return 'title';
  const m = /^heading\s*(\d)$/.exec(n);
  if (!m) return undefined;
  return (['h1', 'h2', 'h3'] as const)[Math.min(2, Number(m[1]) - 1)];
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

/** Image data from a \pict group, from hex text or \bin bytes. */
function pictBytes(hexText: string, binary: number[]): Uint8Array {
  if (binary.length) return new Uint8Array(binary);
  const clean = hexText.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function readRtf(bytes: Uint8Array): RtfResult {
  // RTF is 7-bit ASCII; anything beyond comes as \'hh escapes or \uN.
  const src = new TextDecoder('latin1').decode(bytes);
  if (!/^\s*\{\\rtf/.test(src)) throw new RtfReadError('not RTF');

  const fonts = new Map<number, { family: FontFamily; codepage?: string }>();
  const colors: (string | undefined)[] = [];
  const styleNames = new Map<number, string>();
  let defaultFont = 0;
  let codepage = 'windows-1252';
  const page: PageSetup = { width: A4.width, height: A4.height, margin: { ...A4.margin } };
  let pageSet = false;
  const warnings = new Set<string>();

  const blocks: Block[] = [];
  let runs: Run[] = [];
  const baseChar = (): CharState => ({ bold: false, italic: false, underline: false, strike: false, hidden: false, fs: 24, font: defaultFont, color: 0, highlight: 0, uc: 1 });
  const basePara = (): ParaState => ({ align: 'left', style: 0, inTable: false, outline: null, level: 0, listed: false });
  let para = basePara();

  // Tables: rows of cells collected while \intbl paragraphs arrive.
  let table: TableCell[][] | null = null;
  let row: TableCell[] = [];
  let cell: Paragraph[] = [];
  let cellShades: (string | undefined)[] = [];
  let pendingShade: string | undefined;

  const stack: Group[] = [];
  let group: Group = { char: baseChar(), dest: 'text' };
  let skipChars = 0;

  // Per-destination scratch text.
  let destText = '';
  let fontEntry: { index: number; kind: string; charset?: number } | null = null;
  let colorEntry = { r: 0, g: 0, b: 0, set: false };
  let styleEntry: number | null = null;
  let pict: { kind: string | null; w: number; h: number; wGoal: number; hGoal: number; sx: number; sy: number; hexText: string; bin: number[] } | null = null;
  let listText = '';

  let pendingBytes: number[] = [];

  const fontCodepage = () => fonts.get(group.char.font)?.codepage ?? codepage;

  const addText = (value: string) => {
    if (!value) return;
    const g = group;
    switch (g.dest) {
      case 'skip':
        return;
      case 'fonttbl':
      case 'stylesheet':
      case 'fldinst':
        destText += value;
        return;
      case 'colortbl':
        return;
      case 'listtext':
        listText += value;
        return;
      case 'pict':
        if (pict) pict.hexText += value;
        return;
    }
    if (g.char.hidden) return;
    const c = g.char;
    const props: Omit<TextRun, 'type' | 'text'> = {};
    if (c.bold) props.bold = true;
    if (c.italic) props.italic = true;
    if (c.underline) props.underline = true;
    if (c.strike) props.strike = true;
    props.size = c.fs / 2;
    const color = colors[c.color];
    if (color && color !== '#000000') props.color = color;
    const highlight = colors[c.highlight];
    if (c.highlight && highlight && highlight !== '#ffffff') props.highlight = highlight;
    const family = fonts.get(c.font)?.family;
    if (family && family !== 'sans') props.font = family;
    if (c.link) props.link = c.link;
    // Tabs and line breaks keep their meaning inside a run.
    const parts = value.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) runs.push({ type: 'break' });
      if (!part) return;
      const last = runs[runs.length - 1];
      if (
        last?.type === 'text' &&
        last.bold === props.bold && last.italic === props.italic && last.underline === props.underline && last.strike === props.strike &&
        last.size === props.size && last.color === props.color && last.highlight === props.highlight && last.font === props.font && last.link === props.link
      ) {
        last.text += part;
      } else runs.push({ type: 'text', text: part, ...props });
    });
  };

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    let decoded: string;
    try {
      decoded = new TextDecoder(fontCodepage()).decode(new Uint8Array(pendingBytes));
    } catch {
      decoded = new TextDecoder('windows-1252').decode(new Uint8Array(pendingBytes));
    }
    pendingBytes = [];
    addText(decoded);
  };

  const endParagraph = (kind: 'par' | 'cell') => {
    flushBytes();
    const style = styleNames.get(para.style);
    let pStyle: ParagraphStyle = (style ? headingFor(style) : undefined) ?? 'normal';
    if (pStyle === 'normal' && para.outline !== null && para.outline < 3) pStyle = (['h1', 'h2', 'h3'] as const)[para.outline];
    const p: Paragraph = { type: 'paragraph', style: pStyle, align: para.align, runs };
    if (para.listed || listText) {
      const marker = listText.replace(/\t/g, '').trim();
      p.list = { ordered: /^[(]?[0-9a-zA-Z]{1,4}[.)]$/.test(marker), level: Math.min(4, para.level) };
    }
    runs = [];
    listText = '';
    if (para.inTable || kind === 'cell') {
      cell.push(p);
      return;
    }
    if (table) flushTable();
    blocks.push(p);
  };

  const endCell = () => {
    if (runs.length || !cell.length) endParagraph('cell');
    row.push({ paragraphs: cell, shade: cellShades[row.length] });
    cell = [];
  };

  const endRow = () => {
    if (cell.length || runs.length) endCell();
    if (row.length) (table ??= []).push(row);
    row = [];
  };

  const flushTable = () => {
    if (row.length) endRow();
    if (table?.length) blocks.push({ type: 'table', rows: table });
    table = null;
  };

  const finishPict = () => {
    if (!pict) return;
    const { kind } = pict;
    if (kind === 'png' || kind === 'jpeg') {
      const data = pictBytes(pict.hexText, pict.bin);
      const pxW = pict.w || 1;
      const pxH = pict.h || 1;
      // Goal sizes are twips; without them assume 96 DPI.
      let width = pict.wGoal ? pict.wGoal / 20 : pxW * 0.75;
      let height = pict.hGoal ? pict.hGoal / 20 : pxH * 0.75;
      width *= pict.sx / 100;
      height *= pict.sy / 100;
      if (data.length && width > 0 && height > 0) {
        const image: ImageRun = { type: 'image', data, mime: kind === 'png' ? 'image/png' : 'image/jpeg', width, height };
        runs.push(image);
      }
    } else if (kind) {
      warnings.add('drawings in Windows metafile format');
    }
    pict = null;
  };

  /** Saves the font being read. Entries are usually groups of their own, but TextEdit lists them in one. */
  const commitFont = () => {
    if (fontEntry) {
      const name = destText.replace(/;.*$/s, '').trim();
      const cp = fontEntry.charset !== undefined ? CHARSET_CODEPAGE[fontEntry.charset] : undefined;
      fonts.set(fontEntry.index, { family: familyFor(fontEntry.kind, name), codepage: fontEntry.charset === 2 ? undefined : cp });
    }
    fontEntry = null;
    destText = '';
  };

  const endGroup = () => {
    flushBytes();
    const closing = group;
    switch (closing.dest) {
      case 'fonttbl':
        commitFont();
        break;
      case 'stylesheet':
        if (styleEntry !== null && destText.trim()) styleNames.set(styleEntry, destText.replace(/;.*$/s, '').trim());
        destText = '';
        break;
      case 'pict':
        finishPict();
        break;
      case 'fldinst': {
        const m = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(destText) ?? /HYPERLINK\s+(\S+)/i.exec(destText);
        const parent = stack[stack.length - 1];
        if (m && parent?.field) parent.field.url = m[1];
        break;
      }
    }
    group = stack.pop() ?? { char: baseChar(), dest: 'text' };
    if (group.para) para = group.para;
  };

  const control = (word: string, param: number | null) => {
    const g = group;
    const c = g.char;
    const on = param === null || param !== 0;

    // Destinations first: they change what the rest of the group means.
    switch (word) {
      case 'fonttbl':
        g.dest = 'fonttbl';
        return;
      case 'colortbl':
        g.dest = 'colortbl';
        colorEntry = { r: 0, g: 0, b: 0, set: false };
        return;
      case 'stylesheet':
        g.dest = 'stylesheet';
        return;
      case 'pict':
        g.dest = 'pict';
        pict = { kind: null, w: 0, h: 0, wGoal: 0, hGoal: 0, sx: 100, sy: 100, hexText: '', bin: [] };
        return;
      case 'fldinst':
        g.dest = 'fldinst';
        destText = '';
        return;
      case 'field':
        g.field = {};
        return;
      case 'fldrslt': {
        const field = [...stack].reverse().find((s) => s.field)?.field;
        if (field?.url) c.link = field.url;
        return;
      }
      case 'listtext':
      case 'pntext':
        g.dest = 'listtext';
        para.listed = true;
        return;
      case 'shppict':
      case 'shp':
      case 'shptxt':
        return;
    }
    if (SKIPPED.has(word)) {
      g.dest = 'skip';
      return;
    }

    if (g.dest === 'fonttbl') {
      if (word === 'f') {
        if (fontEntry) commitFont();
        fontEntry = { index: param ?? 0, kind: 'fnil' };
      }
      else if (fontEntry && /^f(roman|swiss|modern|script|decor|tech|bidi|nil)$/.test(word)) fontEntry.kind = word;
      else if (fontEntry && word === 'fcharset') fontEntry.charset = param ?? 0;
      return;
    }
    if (g.dest === 'colortbl') {
      if (word === 'red') colorEntry = { ...colorEntry, r: param ?? 0, set: true };
      else if (word === 'green') colorEntry = { ...colorEntry, g: param ?? 0, set: true };
      else if (word === 'blue') colorEntry = { ...colorEntry, b: param ?? 0, set: true };
      return;
    }
    if (g.dest === 'stylesheet') {
      if (word === 's' || word === 'cs' || word === 'ds' || word === 'ts') styleEntry = word === 's' ? (param ?? 0) : null;
      return;
    }
    if (g.dest === 'pict' && pict) {
      if (word === 'pngblip') pict.kind = 'png';
      else if (word === 'jpegblip') pict.kind = 'jpeg';
      else if (/^(emfblip|wmetafile|macpict|dibitmap|wbitmap|pmmetafile)$/.test(word)) pict.kind ??= word;
      else if (word === 'picw') pict.w = param ?? 0;
      else if (word === 'pich') pict.h = param ?? 0;
      else if (word === 'picwgoal') pict.wGoal = param ?? 0;
      else if (word === 'pichgoal') pict.hGoal = param ?? 0;
      else if (word === 'picscalex') pict.sx = param ?? 100;
      else if (word === 'picscaley') pict.sy = param ?? 100;
      return;
    }
    if (g.dest === 'skip') return;

    if (word in SYMBOLS) {
      flushBytes();
      addText(SYMBOLS[word]);
      return;
    }

    switch (word) {
      case 'ansicpg':
        codepage = ANSICPG[param ?? 1252] ?? 'windows-1252';
        break;
      case 'mac':
        codepage = 'macintosh';
        break;
      case 'deff':
        defaultFont = param ?? 0;
        c.font = defaultFont;
        break;
      case 'paperw':
        page.width = (param ?? 11906) / 20;
        pageSet = true;
        break;
      case 'paperh':
        page.height = (param ?? 16838) / 20;
        pageSet = true;
        break;
      case 'margl':
        page.margin.left = (param ?? 1800) / 20;
        break;
      case 'margr':
        page.margin.right = (param ?? 1800) / 20;
        break;
      case 'margt':
        page.margin.top = (param ?? 1440) / 20;
        break;
      case 'margb':
        page.margin.bottom = (param ?? 1440) / 20;
        break;
      case 'landscape':
        if (page.width < page.height) [page.width, page.height] = [page.height, page.width];
        break;
      case 'par':
      case 'sect':
        endParagraph('par');
        break;
      case 'line':
        flushBytes();
        addText('\n');
        break;
      case 'tab':
        flushBytes();
        addText('\t');
        break;
      case 'page':
        flushBytes();
        if (runs.length) endParagraph('par');
        if (table) flushTable();
        blocks.push({ type: 'pagebreak' });
        break;
      case 'pard':
        para = { ...basePara(), inTable: false };
        break;
      case 'intbl':
        para.inTable = true;
        break;
      case 'trowd':
        cellShades = [];
        pendingShade = undefined;
        break;
      case 'clcbpat':
      case 'clcbpatraw':
        pendingShade = colors[param ?? 0];
        break;
      case 'cellx':
        cellShades.push(pendingShade && pendingShade !== '#ffffff' ? pendingShade : undefined);
        pendingShade = undefined;
        break;
      case 'cell':
      case 'nestcell':
        flushBytes();
        endCell();
        break;
      case 'row':
      case 'nestrow':
        endRow();
        break;
      case 'ql':
        para.align = 'left';
        break;
      case 'qc':
        para.align = 'center';
        break;
      case 'qr':
        para.align = 'right';
        break;
      case 'qj':
      case 'qd':
        para.align = 'justify';
        break;
      case 's':
        para.style = param ?? 0;
        break;
      case 'outlinelevel':
        para.outline = param ?? null;
        break;
      case 'ilvl':
        para.level = param ?? 0;
        break;
      case 'ls':
        para.listed = true;
        break;
      case 'plain':
        Object.assign(c, { bold: false, italic: false, underline: false, strike: false, hidden: false, fs: 24, font: defaultFont, color: 0, highlight: 0 });
        break;
      case 'b':
        c.bold = on;
        break;
      case 'i':
        c.italic = on;
        break;
      case 'ul':
      case 'uld':
      case 'uldb':
      case 'uldash':
      case 'ulth':
      case 'ulw':
      case 'ulwave':
        c.underline = on;
        break;
      case 'ulnone':
        c.underline = false;
        break;
      case 'strike':
      case 'striked':
        c.strike = on;
        break;
      case 'v':
        c.hidden = on;
        break;
      case 'fs':
        c.fs = param && param > 0 ? param : 24;
        break;
      case 'f':
        flushBytes();
        c.font = param ?? defaultFont;
        break;
      case 'cf':
        c.color = param ?? 0;
        break;
      case 'highlight':
      case 'cb':
      case 'chcbpat':
        c.highlight = param ?? 0;
        break;
      case 'uc':
        c.uc = param ?? 1;
        break;
      case 'u': {
        flushBytes();
        let code = param ?? 0;
        if (code < 0) code += 65536;
        addText(String.fromCharCode(code));
        skipChars = c.uc;
        break;
      }
    }
  };

  // The tokenizer.
  let i = 0;
  let starred = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      flushBytes();
      group.para = { ...para };
      stack.push(group);
      group = { char: { ...group.char }, dest: group.dest === 'text' || group.dest === 'skip' || group.dest === 'listtext' ? group.dest : group.dest === 'pict' ? 'skip' : group.dest, field: undefined };
      // Entries in the font table and stylesheet are groups of their own (a group inside an entry,
      // such as an alternative font name, is skipped as an unknown destination instead).
      if (group.dest === 'fonttbl' && stack[stack.length - 1].dest === 'fonttbl' && stack[stack.length - 2]?.dest !== 'fonttbl') {
        commitFont();
      }
      if (group.dest === 'stylesheet' && stack[stack.length - 2]?.dest !== 'stylesheet') {
        styleEntry = 0;
        destText = '';
      }
      starred = false;
      skipChars = 0;
      i++;
      continue;
    }
    if (ch === '}') {
      endGroup();
      skipChars = 0;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === undefined) break;
      if (/[a-zA-Z]/.test(next)) {
        const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(src.slice(i + 1, i + 50))!;
        const word = m[1];
        const param = m[2] !== undefined ? Number(m[2]) : null;
        i += 1 + m[0].length;
        if (word === 'bin' && param) {
          // Assigned inside control(), which TypeScript's narrowing cannot see.
          const picture = pict as { bin: number[] } | null;
          if (group.dest === 'pict' && picture) for (let k = 0; k < param; k++) picture.bin.push(src.charCodeAt(i + k) & 0xff);
          i += param;
          continue;
        }
        if (skipChars > 0 && word !== 'u') {
          skipChars--;
          continue;
        }
        if (starred) {
          starred = false;
          // An optional destination we do not know is skipped whole.
          const known = ['fldinst', 'shppict', 'listtext', 'pntext'].includes(word) || SKIPPED.has(word);
          if (!known) {
            group.dest = 'skip';
            continue;
          }
        }
        control(word, param);
        continue;
      }
      i += 2;
      if (next === '*') {
        starred = true;
        continue;
      }
      if (next === "'") {
        const byte = parseInt(src.slice(i, i + 2), 16);
        i += 2;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!Number.isNaN(byte)) {
          if (group.dest === 'text' || group.dest === 'listtext' || group.dest === 'fonttbl' || group.dest === 'stylesheet' || group.dest === 'fldinst') pendingBytes.push(byte);
        }
        continue;
      }
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      flushBytes();
      if (next === '\\' || next === '{' || next === '}') addText(next);
      else if (next === '~') addText(' ');
      else if (next === '_') addText('‑');
      else if (next === '\n' || next === '\r') control('par', null);
      else if (next === '|' || next === ':') addText(next);
      // \- (optional hyphen) and anything else adds nothing.
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    // Plain text up to the next special character.
    let j = i;
    while (j < src.length && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
    let chunk = src.slice(i, j);
    i = j;
    if (skipChars > 0) {
      const drop = Math.min(skipChars, chunk.length);
      chunk = chunk.slice(drop);
      skipChars -= drop;
    }
    if (group.dest === 'colortbl') {
      // Each ";" ends a colour; the first, empty entry is "auto".
      for (const c of chunk) {
        if (c !== ';') continue;
        colors.push(colorEntry.set ? `#${hex(colorEntry.r)}${hex(colorEntry.g)}${hex(colorEntry.b)}` : undefined);
        colorEntry = { r: 0, g: 0, b: 0, set: false };
      }
      continue;
    }
    if (chunk) {
      flushBytes();
      addText(chunk);
    }
  }
  flushBytes();
  if (runs.length) endParagraph('par');
  if (table || row.length) flushTable();

  // Page size from TextEdit or WordPad files without one: keep A4, the app's default.
  if (!pageSet) Object.assign(page, { width: A4.width, height: A4.height });
  if (!blocks.length) blocks.push({ type: 'paragraph', style: 'normal', align: 'left', runs: [] });
  return { doc: { page, blocks }, warnings: [...warnings] };
}

export function isRtf(file: File): boolean {
  return /\.rtf$/i.test(file.name) || file.type === 'application/rtf' || file.type === 'text/rtf';
}
