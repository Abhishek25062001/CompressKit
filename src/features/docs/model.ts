/**
 * A plain document model shared by the Word tools. DOCX files are read into it, the editor shows
 * it as HTML, and it is written back out as DOCX or laid out as a PDF. It keeps what most letters,
 * reports and CVs use (headings, text styles, lists, tables, pictures, page breaks) and leaves out
 * what cannot be edited or laid out faithfully in a browser (text boxes, charts, tracked changes).
 */

export type Align = 'left' | 'center' | 'right' | 'justify';

/** Fonts are reduced to three families, which PDF readers have built in. */
export type FontFamily = 'sans' | 'serif' | 'mono';

export interface TextRun {
  type: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Points. Unset uses the paragraph style's size. */
  size?: number;
  /** "#rrggbb". */
  color?: string;
  /** "#rrggbb" behind the text. */
  highlight?: string;
  font?: FontFamily;
  link?: string;
}

/** A line break inside a paragraph (Shift+Enter in Word). */
export interface BreakRun {
  type: 'break';
}

/** A picture in the text flow, sized in points. */
export interface ImageRun {
  type: 'image';
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export type Run = TextRun | BreakRun | ImageRun;

export type ParagraphStyle = 'normal' | 'title' | 'h1' | 'h2' | 'h3' | 'quote';

export interface Paragraph {
  type: 'paragraph';
  style: ParagraphStyle;
  align: Align;
  list?: { ordered: boolean; level: number };
  runs: Run[];
}

export interface TableCell {
  paragraphs: Paragraph[];
  /** Columns this cell spans. */
  span?: number;
  shade?: string;
}

export interface Table {
  type: 'table';
  rows: TableCell[][];
}

export interface PageBreak {
  type: 'pagebreak';
}

export type Block = Paragraph | Table | PageBreak;

/** Page size and margins in points. */
export interface PageSetup {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface DocModel {
  page: PageSetup;
  blocks: Block[];
}

export const A4: PageSetup = { width: 595.28, height: 841.89, margin: { top: 72, right: 72, bottom: 72, left: 72 } };

/** Font size and spacing per paragraph style, in points. */
export const STYLE_METRICS: Record<ParagraphStyle, { size: number; bold: boolean; italic?: boolean; before: number; after: number }> = {
  normal: { size: 11, bold: false, before: 0, after: 8 },
  title: { size: 26, bold: true, before: 0, after: 12 },
  h1: { size: 18, bold: true, before: 16, after: 8 },
  h2: { size: 14, bold: true, before: 12, after: 6 },
  h3: { size: 12, bold: true, before: 10, after: 4 },
  quote: { size: 11, bold: false, italic: true, before: 6, after: 10 },
};

export function paragraph(runs: Run[] = [], style: ParagraphStyle = 'normal', align: Align = 'left'): Paragraph {
  return { type: 'paragraph', style, align, runs };
}

export function text(value: string, props: Omit<TextRun, 'type' | 'text'> = {}): TextRun {
  return { type: 'text', text: value, ...props };
}

/** The plain text of a paragraph. */
export function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => (r.type === 'text' ? r.text : r.type === 'break' ? '\n' : '')).join('');
}

/** Joins several documents into one, each starting on a new page. Page setup follows the first. */
export function concatDocs(docs: DocModel[]): DocModel {
  const blocks: Block[] = [];
  docs.forEach((doc, i) => {
    if (i > 0) blocks.push({ type: 'pagebreak' });
    blocks.push(...doc.blocks);
  });
  return { page: docs[0]?.page ?? A4, blocks };
}

/** Counts words, for the editor's status line. */
export function countWords(doc: DocModel): number {
  let n = 0;
  const count = (p: Paragraph) => {
    n += paragraphText(p).split(/\s+/).filter(Boolean).length;
  };
  for (const b of doc.blocks) {
    if (b.type === 'paragraph') count(b);
    else if (b.type === 'table') b.rows.forEach((row) => row.forEach((cell) => cell.paragraphs.forEach(count)));
  }
  return n;
}
