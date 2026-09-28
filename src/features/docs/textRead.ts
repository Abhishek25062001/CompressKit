import { isMarkdown } from './formats';
import { A4, paragraph, text, type Block, type DocModel, type FontFamily, type PageSetup, type Paragraph, type ParagraphStyle, type Run, type TableCell, type TextRun } from './model';

/**
 * Plain text and Markdown files, read into the shared document model for laying out as a PDF.
 * Plain text keeps its lines exactly: indentation, blank lines and columns lined up with spaces or
 * tabs stay where they were, and form feeds start new pages. Markdown becomes a formatted document.
 */

export interface TextOptions {
  font: FontFamily;
  /** Points. */
  size: number;
  page: 'a4' | 'letter';
}

const LETTER: PageSetup = { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } };
/** Plain text uses narrower margins than a letter: 0.75 inch, so 80-column files fit at 10 pt. */
const TEXT_MARGIN = { top: 54, right: 54, bottom: 54, left: 54 };
const TAB_WIDTH = 8;
const NBSP = '\u00a0';


/**
 * Decodes a text file. A byte-order mark decides when present; otherwise the file is read as UTF-8,
 * and as Windows-1252 (what Notepad saved for years) when it is not valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // UTF-16 without a mark: English text then has a zero in every other byte.
  const sample = bytes.subarray(0, 4096);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2) oddZeros++;
    else evenZeros++;
  }
  if (sample.length >= 8 && oddZeros > sample.length / 4 && evenZeros < sample.length / 50) return new TextDecoder('utf-16le').decode(bytes);
  if (sample.length >= 8 && evenZeros > sample.length / 4 && oddZeros < sample.length / 50) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function pageSetup(options: TextOptions, margin = TEXT_MARGIN): PageSetup {
  const base = options.page === 'letter' ? LETTER : A4;
  return { width: base.width, height: base.height, margin };
}

/** Tabs to spaces at every eighth column, as terminals and code editors show them. */
function expandTabs(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH));
    else out += ch;
  }
  return out;
}

/**
 * One line of text as a paragraph. Leading spaces become no-break spaces: the layout drops
 * ordinary spaces at the start of a line, and indentation matters in text files.
 */
function textLine(line: string, props: Omit<TextRun, 'type' | 'text'>): Paragraph {
  // Control characters other than tabs have no printed form (and no glyph in PDF fonts).
  // eslint-disable-next-line no-control-regex
  const expanded = expandTabs(line.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, ''));
  const indent = /^ */.exec(expanded)![0].length;
  const value = NBSP.repeat(indent) + expanded.slice(indent);
  return { ...paragraph([text(value, props)]), tight: true };
}

export function plainTextToDoc(source: string, options: TextOptions): DocModel {
  const blocks: Block[] = [];
  const pages = source.replace(/\r\n?/g, '\n').split('\f');
  pages.forEach((pageText, i) => {
    if (i > 0) blocks.push({ type: 'pagebreak' });
    const lines = pageText.split('\n');
    // A final newline ends the last line; it does not add an empty one.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) blocks.push(textLine(line, { font: options.font, size: options.size }));
  });
  return { page: pageSetup(options), blocks };
}

// ---------------------------------------------------------------------------------------------
// Markdown (CommonMark's everyday subset plus GitHub tables and strikethrough).

type Inline = Omit<TextRun, 'type' | 'text'>;

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|~>])/g;

/** Inline Markdown: code spans, links, images (as their alt text), bold, italic and strikethrough. */
function inlineRuns(source: string, base: Inline): Run[] {
  const runs: Run[] = [];
  const push = (value: string, props: Inline) => {
    if (!value) return;
    const last = runs[runs.length - 1];
    if (last?.type === 'text' && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ type: 'text', text: '', ...props })) last.text += value;
    else runs.push({ type: 'text', text: value, ...props });
  };

  const walk = (s: string, props: Inline) => {
    let i = 0;
    let plain = '';
    const flush = () => {
      push(plain.replace(ESCAPABLE, '$1'), props);
      plain = '';
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|~>]/.test(s[i + 1])) {
        plain += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') {
        const ticks = /^`+/.exec(s.slice(i))![0];
        const end = s.indexOf(ticks, i + ticks.length);
        if (end > 0) {
          flush();
          push(s.slice(i + ticks.length, end).trim() || s.slice(i + ticks.length, end), { ...props, font: 'mono', highlight: '#f0f0f0' });
          i = end + ticks.length;
          continue;
        }
      }
      if (ch === '!' && s[i + 1] === '[') {
        const m = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(s.slice(i));
        if (m) {
          flush();
          if (m[1]) push(`[${m[1]}]`, { ...props, italic: true, color: '#6b7280' });
          i += m[0].length;
          continue;
        }
      }
      if (ch === '[') {
        const m = /^\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(s.slice(i));
        if (m) {
          flush();
          walk(m[1], { ...props, link: m[2] });
          i += m[0].length;
          continue;
        }
      }
      if (ch === '<') {
        const m = /^<((?:https?|mailto):[^>\s]+)>/.exec(s.slice(i));
        if (m) {
          flush();
          push(m[1], { ...props, link: m[1] });
          i += m[0].length;
          continue;
        }
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        const run = new RegExp(`^\\${ch}+`).exec(s.slice(i))![0];
        const n = Math.min(run.length, ch === '~' ? 2 : 3);
        // Underscores inside words (snake_case) are not emphasis.
        const intraword = ch === '_' && /\w/.test(s[i - 1] ?? '') ;
        if (!intraword && (ch !== '~' || n === 2) && s[i + n] && !/\s/.test(s[i + n])) {
          const marker = ch.repeat(n);
          let end = i + n;
          while ((end = s.indexOf(marker, end)) > 0 && (/\s/.test(s[end - 1]) || (ch === '_' && /\w/.test(s[end + n] ?? '')))) end += n;
          if (end > i + n) {
            flush();
            const inner = s.slice(i + n, end);
            const next: Inline =
              ch === '~' ? { ...props, strike: true } : n === 3 ? { ...props, bold: true, italic: true } : n === 2 ? { ...props, bold: true } : { ...props, italic: true };
            walk(inner, next);
            i = end + n;
            continue;
          }
        }
        plain += run;
        i += run.length;
        continue;
      }
      plain += ch;
      i++;
    }
    flush();
  };
  walk(source, base);
  return runs.length ? runs : [text('', base)];
}

const HEADING_STYLE: ParagraphStyle[] = ['title', 'h1', 'h2', 'h3', 'h3', 'h3'];

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      current += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else current += s[i];
  }
  cells.push(current.trim());
  return cells;
}

const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;

export function markdownToDoc(source: string, options: TextOptions): DocModel {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const body: Inline = { font: options.font === 'mono' ? 'sans' : options.font, size: options.size };
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    // Two trailing spaces or a backslash end a line inside a paragraph.
    const runs: Run[] = [];
    para.forEach((line, i) => {
      const hard = / {2,}$/.test(line) || line.endsWith('\\');
      const content = line.replace(/ {2,}$/, '').replace(/\\$/, '').trim();
      runs.push(...inlineRuns(content, body));
      if (i < para.length - 1) runs.push(hard ? { type: 'break' } : { type: 'text', text: ' ', ...body });
    });
    blocks.push(paragraph(runs));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }

    // Fenced code block: lines kept exactly, in a monospace font.
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flushPara();
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      let j = i + 1;
      for (; j < lines.length && !close.test(lines[j]); j++) {
        blocks.push(textLine(lines[j], { font: 'mono', size: Math.max(8, options.size - 1), highlight: '#f3f4f6' }));
      }
      i = j;
      blocks.push({ ...paragraph([text('', { size: 4 })]), tight: true });
      continue;
    }

    // Indented code (four spaces) when not continuing a paragraph or list.
    if (!para.length && /^( {4}|\t)/.test(line) && !LIST_ITEM.test(line)) {
      blocks.push(textLine(line.replace(/^( {4}|\t)/, ''), { font: 'mono', size: Math.max(8, options.size - 1), highlight: '#f3f4f6' }));
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push(paragraph(inlineRuns(heading[2], {}), HEADING_STYLE[heading[1].length - 1]));
      continue;
    }

    // Setext headings: a line underlined with === or ---.
    if (para.length === 1 && /^ {0,3}(=+|-+)\s*$/.test(line)) {
      const style = line.trim()[0] === '=' ? 'title' : 'h1';
      blocks.push(paragraph(inlineRuns(para[0].trim(), {}), style));
      para = [];
      continue;
    }

    if (/^ {0,3}([-*_])( *\1){2,}\s*$/.test(line)) {
      flushPara();
      // A thematic break: a short gap, since the layout has no rules to draw.
      blocks.push({ ...paragraph([text('', { size: options.size })]), tight: true });
      continue;
    }

    // GitHub table: a header row, a delimiter row, then body rows.
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left') as Paragraph['align']);
      const rows: TableCell[][] = [header.map((c, k) => ({ paragraphs: [paragraph(inlineRuns(c, { ...body, bold: true }), 'normal', aligns[k] ?? 'left')], shade: '#f3f4f6' }))];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim() && lines[j].includes('|'); j++) {
        const cells = splitRow(lines[j]);
        rows.push(header.map((_, k) => ({ paragraphs: [paragraph(inlineRuns(cells[k] ?? '', body), 'normal', aligns[k] ?? 'left')] })));
      }
      blocks.push({ type: 'table', rows });
      i = j - 1;
      continue;
    }

    const quote = /^ {0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      const parts = [quote[1]];
      while (i + 1 < lines.length && /^ {0,3}>/.test(lines[i + 1])) parts.push(/^ {0,3}>\s?(.*)$/.exec(lines[++i])![1]);
      blocks.push(paragraph(inlineRuns(parts.join(' ').trim(), body), 'quote'));
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item && (!para.length || item[1].length === 0)) {
      flushPara();
      const level = Math.min(4, Math.floor(item[1].length / 2));
      const ordered = /\d/.test(item[2]);
      let content = item[4];
      // Task lists: [ ] and [x].
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(content);
      if (task) content = `${task[1] === ' ' ? '☐' : '☑'} ${task[2]}`;
      // Lazy continuation lines belong to the item.
      while (i + 1 < lines.length && lines[i + 1].trim() && !LIST_ITEM.test(lines[i + 1]) && /^ {2,}\S/.test(lines[i + 1]) && !/^ {0,3}(#|>|```|~~~)/.test(lines[i + 1])) {
        content += ` ${lines[++i].trim()}`;
      }
      blocks.push({ ...paragraph(inlineRuns(content, body)), list: { ordered, level } });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return { page: pageSetup(options, { top: 72, right: 72, bottom: 72, left: 72 }), blocks: blocks.length ? blocks : [paragraph()] };
}

/** Reads a .txt or .md file into the document model. */
export async function readTextFile(file: File, options: TextOptions): Promise<DocModel> {
  const source = decodeText(new Uint8Array(await file.arrayBuffer()));
  return isMarkdown(file) ? markdownToDoc(source, options) : plainTextToDoc(source, options);
}
