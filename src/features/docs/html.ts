import type { Align, Block, DocModel, FontFamily, ImageRun, Paragraph, ParagraphStyle, Run, Table, TableCell, TextRun } from './model';

/**
 * The editor shows a document as ordinary HTML in an editable area. These functions turn the model
 * into that HTML and read the edited HTML back into the model. Pictures carry their bytes in a map
 * keyed by an id on the <img>, so the page never holds large data: URLs.
 */

const TAG: Record<ParagraphStyle, string> = { normal: 'p', title: 'h1', h1: 'h2', h2: 'h3', h3: 'h4', quote: 'blockquote' };
const FAMILY_CSS: Record<FontFamily, string> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

export interface ImageStore {
  /** id → picture, for the <img data-img> elements in the editor. */
  images: Map<string, ImageRun & { url: string }>;
}

export function createImageStore(): ImageStore {
  return { images: new Map() };
}

export function releaseImages(store: ImageStore): void {
  store.images.forEach((img) => URL.revokeObjectURL(img.url));
  store.images.clear();
}

let imageSeq = 0;

export function addImage(store: ImageStore, image: ImageRun): string {
  const id = `img${++imageSeq}`;
  const url = URL.createObjectURL(new Blob([image.data as BlobPart], { type: image.mime }));
  store.images.set(id, { ...image, url });
  return id;
}

/** An editor picture, sized in points like the document. */
export function imageTag(id: string, store: ImageStore, width: number, height: number): string {
  return `<img data-img="${id}" src="${store.images.get(id)!.url}" style="width:${width.toFixed(1)}pt;height:${height.toFixed(1)}pt" alt="">`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runHtml(r: Run, store: ImageStore): string {
  if (r.type === 'break') return '<br>';
  if (r.type === 'image') {
    const id = addImage(store, r);
    return imageTag(id, store, r.width, r.height);
  }
  let html = escapeHtml(r.text).replace(/\t/g, '<span class="doc-tab">\t</span>');
  const style: string[] = [];
  if (r.size) style.push(`font-size:${r.size}pt`);
  if (r.color) style.push(`color:${r.color}`);
  if (r.highlight) style.push(`background-color:${r.highlight}`);
  if (r.font) style.push(`font-family:${FAMILY_CSS[r.font]}`);
  if (style.length) html = `<span style="${escapeHtml(style.join(';'))}">${html}</span>`;
  if (r.bold) html = `<b>${html}</b>`;
  if (r.italic) html = `<i>${html}</i>`;
  if (r.underline) html = `<u>${html}</u>`;
  if (r.strike) html = `<s>${html}</s>`;
  if (r.link) html = `<a href="${escapeHtml(r.link)}">${html}</a>`;
  return html;
}

function paragraphInner(p: Paragraph, store: ImageStore): string {
  const inner = p.runs.map((r) => runHtml(r, store)).join('');
  // An empty paragraph needs a <br> to keep its height and take the caret.
  return inner || '<br>';
}

function alignAttr(align: Align): string {
  return align === 'left' ? '' : ` style="text-align:${align}"`;
}

function tableHtml(t: Table, store: ImageStore): string {
  const rows = t.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => {
            const attrs = `${cell.span ? ` colspan="${cell.span}"` : ''}${cell.shade ? ` style="background-color:${cell.shade}"` : ''}`;
            const body = cell.paragraphs.length
              ? cell.paragraphs.map((p) => `<p${alignAttr(p.align)}>${paragraphInner(p, store)}</p>`).join('')
              : '<p><br></p>';
            return `<td${attrs}>${body}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

export function docToHtml(doc: DocModel, store: ImageStore): string {
  let html = '';
  let i = 0;
  const blocks = doc.blocks;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'pagebreak') {
      html += '<hr class="doc-page-break" contenteditable="false">';
      i++;
    } else if (b.type === 'table') {
      html += tableHtml(b, store);
      i++;
    } else if (b.list) {
      // Consecutive list paragraphs become one list, nested by level.
      const start = i;
      while (i < blocks.length && blocks[i].type === 'paragraph' && (blocks[i] as Paragraph).list) i++;
      html += listHtml(blocks.slice(start, i) as Paragraph[], store);
    } else {
      html += `<${TAG[b.style]}${alignAttr(b.align)}>${paragraphInner(b, store)}</${TAG[b.style]}>`;
      i++;
    }
  }
  return html || '<p><br></p>';
}

function listHtml(items: Paragraph[], store: ImageStore): string {
  let html = '';
  const open: string[] = [];
  for (const p of items) {
    const level = p.list!.level;
    const tag = p.list!.ordered ? 'ol' : 'ul';
    while (open.length > level + 1) html += `</li></${open.pop()}>`;
    if (open.length === level + 1 && open[level] !== tag) html += `</li></${open.pop()}>`;
    if (open.length === level + 1) html += '</li>';
    while (open.length < level + 1) {
      html += `<${tag}>`;
      open.push(tag);
    }
    html += `<li${alignAttr(p.align)}>${paragraphInner(p, store)}`;
  }
  while (open.length) html += `</li></${open.pop()}>`;
  return html;
}

// ---------------------------------------------------------------------------------------------
// HTML back to the model.

type RunProps = Omit<TextRun, 'type' | 'text'>;

function parseColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'inherit' || v === 'initial') return undefined;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?/.exec(v);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  }
  // Named colours through the browser.
  const probe = document.createElement('span');
  probe.style.color = v;
  if (!probe.style.color) return undefined;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb.startsWith('rgb') ? parseColor(rgb) : undefined;
}

const FONT_SIZES_PT = [0, 7.5, 10, 12, 13.5, 18, 24, 36];

function parseSize(value: string): number | undefined {
  const m = /^([\d.]+)(pt|px|em|rem)?$/.exec(value.trim());
  if (!m) {
    const named: Record<string, number> = { 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24 };
    return named[value.trim()];
  }
  const n = parseFloat(m[1]);
  const unit = m[2] ?? 'px';
  const pt = unit === 'pt' ? n : unit === 'px' ? n * 0.75 : n * 11;
  return Math.round(pt * 2) / 2;
}

function familyOf(value: string): FontFamily | undefined {
  const v = value.toLowerCase();
  if (!v) return undefined;
  if (/mono|courier|consol/.test(v)) return 'mono';
  if (/times|georgia|serif/.test(v) && !/sans-serif/.test(v)) return 'serif';
  return 'sans';
}

function propsFrom(el: HTMLElement, inherited: RunProps): RunProps {
  const p: RunProps = { ...inherited };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') p.bold = true;
  if (tag === 'I' || tag === 'EM') p.italic = true;
  if (tag === 'U' || tag === 'INS') p.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') p.strike = true;
  if (tag === 'A' && el.getAttribute('href')) p.link = el.getAttribute('href')!;
  if (tag === 'FONT') {
    const color = el.getAttribute('color');
    if (color) p.color = parseColor(color) ?? p.color;
    const size = Number(el.getAttribute('size'));
    if (size >= 1 && size <= 7) p.size = FONT_SIZES_PT[size];
    const face = el.getAttribute('face');
    if (face) p.font = familyOf(face) ?? p.font;
  }
  const s = el.style;
  if (s.fontWeight) p.bold = s.fontWeight === 'bold' || Number(s.fontWeight) >= 600;
  if (s.fontStyle) p.italic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
  const deco = `${s.textDecorationLine || s.textDecoration}`;
  if (deco.includes('underline')) p.underline = true;
  if (deco.includes('line-through')) p.strike = true;
  if (s.color) p.color = parseColor(s.color) ?? p.color;
  if (s.backgroundColor) p.highlight = parseColor(s.backgroundColor) ?? p.highlight;
  if (s.fontSize) p.size = parseSize(s.fontSize) ?? p.size;
  if (s.fontFamily) p.font = familyOf(s.fontFamily) ?? p.font;
  return p;
}

function sameProps(a: TextRun, b: RunProps): boolean {
  const keys: (keyof RunProps)[] = ['bold', 'italic', 'underline', 'strike', 'size', 'color', 'highlight', 'font', 'link'];
  return keys.every((k) => (a[k] ?? undefined) === (b[k] ?? undefined));
}

function clean(props: RunProps): RunProps {
  const out: RunProps = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== false) (out as Record<string, unknown>)[k] = v;
  return out;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);

function styleOfTag(tag: string): ParagraphStyle {
  switch (tag) {
    case 'H1':
      return 'title';
    case 'H2':
      return 'h1';
    case 'H3':
      return 'h2';
    case 'H4':
    case 'H5':
    case 'H6':
      return 'h3';
    case 'BLOCKQUOTE':
      return 'quote';
    default:
      return 'normal';
  }
}

function alignOf(el: HTMLElement): Align | undefined {
  const a = el.style.textAlign || el.getAttribute('align') || '';
  if (a === 'center' || a === 'right' || a === 'justify') return a;
  if (a === 'left' || a === 'start') return 'left';
  if (a === 'end') return 'right';
  return undefined;
}

export function htmlToDoc(root: HTMLElement, store: ImageStore, page: DocModel['page']): DocModel {
  const blocks: Block[] = [];

  /** Reads inline content into runs. Nested block elements end the paragraph and start new ones. */
  const walkBlock = (el: HTMLElement, base: Omit<Paragraph, 'runs'>, out: Block[]) => {
    let runs: Run[] = [];
    let nested = false;
    const flush = (force: boolean) => {
      // A <br> at the end of a block only holds the line open; it adds no line of its own.
      if (runs[runs.length - 1]?.type === 'break') runs.pop();
      if (runs.length || force) out.push({ ...base, runs });
      runs = [];
    };
    const walk = (node: Node, props: RunProps) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = (node.textContent ?? '').replace(/[\r\n]+/g, ' ');
        if (!value) return;
        const last = runs[runs.length - 1];
        const cleaned = clean(props);
        if (last?.type === 'text' && sameProps(last, cleaned)) last.text += value;
        else runs.push({ type: 'text', text: value, ...cleaned });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName;
      if (tag === 'BR') {
        runs.push({ type: 'break' });
        return;
      }
      if (tag === 'IMG') {
        const img = store.images.get(node.dataset.img ?? '');
        if (img) {
          // Sizes are kept in points; a picture resized by the browser has pixel sizes instead.
          const size = (css: string, attr: string | null) =>
            css.endsWith('pt') ? parseFloat(css) : css.endsWith('px') ? parseFloat(css) * 0.75 : attr ? Number(attr) * 0.75 : NaN;
          let width = size(node.style.width, node.getAttribute('width'));
          let height = size(node.style.height, node.getAttribute('height'));
          if (!(width > 0)) width = img.width;
          if (!(height > 0)) height = (width * img.height) / img.width;
          runs.push({ type: 'image', data: img.data, mime: img.mime, width, height });
        }
        return;
      }
      if (tag === 'STYLE' || tag === 'SCRIPT') return;
      if (BLOCK_TAGS.has(tag)) {
        flush(false);
        nested = true;
        readBlock(node, out, base.list);
        return;
      }
      const next = propsFrom(node, props);
      node.childNodes.forEach((c) => walk(c, next));
    };
    el.childNodes.forEach((c) => walk(c, {}));
    // An empty block is a blank line; a block that only wrapped other blocks adds nothing.
    flush(!nested);
  };

  const readList = (list: HTMLElement, level: number, out: Block[]) => {
    const ordered = list.tagName === 'OL';
    for (const li of Array.from(list.children) as HTMLElement[]) {
      if (li.tagName === 'UL' || li.tagName === 'OL') {
        readList(li, level + 1, out);
        continue;
      }
      // The item's own text, then any lists nested inside it.
      const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL') as HTMLElement[];
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => n.remove());
      walkBlock(clone, { type: 'paragraph', style: 'normal', align: alignOf(li) ?? 'left', list: { ordered, level: Math.min(level, 4) } }, out);
      nested.forEach((n) => readList(n, level + 1, out));
    }
  };

  const readTable = (table: HTMLElement): Table => {
    const rows: TableCell[][] = [];
    table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr').forEach((tr) => {
      const row: TableCell[] = [];
      tr.querySelectorAll(':scope > td, :scope > th').forEach((td) => {
        const cellEl = td as HTMLTableCellElement;
        const paragraphs: Block[] = [];
        const hasBlocks = Array.from(cellEl.children).some((c) => BLOCK_TAGS.has(c.tagName));
        if (hasBlocks) Array.from(cellEl.children).forEach((c) => readBlock(c as HTMLElement, paragraphs));
        else walkBlock(cellEl, { type: 'paragraph', style: 'normal', align: alignOf(cellEl) ?? 'left' }, paragraphs);
        row.push({
          paragraphs: paragraphs.filter((b): b is Paragraph => b.type === 'paragraph'),
          span: cellEl.colSpan > 1 ? cellEl.colSpan : undefined,
          shade: parseColor(cellEl.style.backgroundColor),
        });
      });
      if (row.length) rows.push(row);
    });
    return { type: 'table', rows };
  };

  const readBlock = (el: HTMLElement, out: Block[], list?: Paragraph['list']) => {
    const tag = el.tagName;
    if (tag === 'HR') {
      if (el.classList.contains('doc-page-break')) out.push({ type: 'pagebreak' });
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      readList(el, list ? list.level + 1 : 0, out);
      return;
    }
    if (tag === 'TABLE') {
      out.push(readTable(el));
      return;
    }
    walkBlock(el, { type: 'paragraph', style: styleOfTag(tag), align: alignOf(el) ?? 'left', list }, out);
  };

  // Top level: stray inline content (text typed straight into the editor) becomes paragraphs.
  let loose: HTMLElement | null = null;
  const flushLoose = () => {
    if (loose) walkBlock(loose, { type: 'paragraph', style: 'normal', align: 'left' }, blocks);
    loose = null;
  };
  for (const node of Array.from(root.childNodes)) {
    if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
      flushLoose();
      readBlock(node, blocks);
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      continue;
    } else {
      loose ??= document.createElement('p');
      loose.appendChild(node.cloneNode(true));
    }
  }
  flushLoose();
  return { page, blocks };
}
