import { canvasToBlob, getContext, createCanvas, releaseCanvas } from '../image/canvas';
import { addImage, createImageStore, htmlToDoc, releaseImages } from './html';
import type { DocModel, ImageRun, PageSetup } from './model';

/**
 * Reads an HTML file into the shared document model. The page is rendered in a hidden, sandboxed
 * frame (scripts off, nothing fetched from the network) so its stylesheets apply; the computed look
 * of every element (bold, italic, colours, sizes, alignment, fonts, table shading) is then written
 * onto a clean copy, which the editor's HTML reader turns into the model. The result flows like a
 * document: text stays selectable in the PDF, while multi-column layouts and positioned boxes are
 * laid out one after another.
 */

export interface HtmlResult {
  doc: DocModel;
  warnings: string[];
  /** Pictures the file links to on the web or next to it on disk, which are not in the file. */
  missingImages: number;
}


/** Decodes the file using its byte-order mark or <meta charset>, falling back to UTF-8, then Windows-1252. */
export function decodeHtml(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // An unknown label: fall through.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Blocks everything the page could load except pictures and fonts embedded in the file itself. */
const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'";

const INLINE_TAGS = new Set(['A', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'FONT', 'CODE', 'KBD', 'SAMP', 'VAR', 'MARK', 'SMALL', 'BIG', 'SUB', 'SUP', 'ABBR', 'CITE', 'Q', 'DFN', 'TIME', 'LABEL', 'BDI', 'BDO', 'TT']);
const KEEP_BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'CANVAS', 'MAP', 'HEAD', 'TITLE', 'META', 'LINK', 'BASE', 'DIALOG']);

function loadFrame(html: string, width: number, forPrint = false): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    // No allow-scripts: nothing in the file runs. Same origin only so its layout can be read, and
    // modals only for the print dialog.
    frame.setAttribute('sandbox', forPrint ? 'allow-same-origin allow-modals' : 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:1200px;border:0;opacity:0;pointer-events:none`;
    const timer = setTimeout(() => resolve(frame), 15_000);
    frame.onload = () => {
      clearTimeout(timer);
      resolve(frame);
    };
    frame.onerror = () => reject(new Error('frame failed'));
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** The file as HTML the frame may render: scripts and embeds removed, and the network policy added. */
function prepare(source: string): string {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv]').forEach((n) => n.remove());
  const meta = parsed.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = CSP;
  parsed.head.prepend(meta);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

const pxToPt = (px: number) => Math.round(px * 0.75 * 10) / 10;

async function pictureOf(source: CanvasImageSource, width: number, height: number, cssWidth: number): Promise<ImageRun | null> {
  if (!width || !height) return null;
  // Twice the displayed size, capped, so pictures stay sharp when printed.
  const scale = Math.min(2, 2400 / Math.max(width, height), Math.max(1, (cssWidth * 2) / width));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(w, h);
  try {
    const ctx = getContext(canvas);
    ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let transparent = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        transparent = true;
        break;
      }
    }
    // Photos as JPEG keep the PDF small; anything with transparency needs PNG.
    const mime = transparent ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, 0.9);
    return { type: 'image', data: new Uint8Array(await blob.arrayBuffer()), mime, width: 0, height: 0 };
  } catch {
    return null;
  } finally {
    releaseCanvas(canvas);
  }
}

async function svgPicture(svg: SVGSVGElement, rect: DOMRect): Promise<ImageRun | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await pictureOf(img, rect.width, rect.height, rect.width);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Writes the look the browser worked out from every stylesheet onto a copied element. */
function applyLook(copy: HTMLElement, cs: CSSStyleDeclaration, tag: string, block: boolean): void {
  const s = copy.style;
  const outTag = copy.tagName;
  const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
  s.fontWeight = weight >= 600 ? 'bold' : 'normal';
  s.fontStyle = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique' ? 'italic' : 'normal';
  const deco = cs.textDecorationLine || cs.textDecoration;
  if (deco.includes('underline') || deco.includes('line-through')) s.textDecorationLine = deco;
  s.color = cs.color;
  s.fontSize = cs.fontSize;
  s.fontFamily = cs.fontFamily;
  const bg = cs.backgroundColor;
  const hasBg = bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
  if (hasBg && (tag === 'TD' || tag === 'TH' || outTag === 'SPAN' || outTag === 'A' || tag === 'MARK')) s.backgroundColor = bg;
  if (block && cs.textAlign && cs.textAlign !== 'start' && cs.textAlign !== 'left') {
    s.textAlign = cs.textAlign === 'end' ? 'right' : cs.textAlign === '-webkit-center' ? 'center' : cs.textAlign;
  }
}

export async function readHtml(source: string, page: PageSetup): Promise<HtmlResult> {
  const contentPx = Math.round((page.width - page.margin.left - page.margin.right) / 0.75);
  const frame = await loadFrame(prepare(source), contentPx);
  const store = createImageStore();
  let missingImages = 0;
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc?.body || !win) throw new Error('frame has no document');
    // Pictures embedded in the file finish decoding before they are read.
    await Promise.all(Array.from(doc.images).map((img) => (img.complete ? null : img.decode().catch(() => null))));

    const root = document.createElement('div');
    const style = (el: Element) => win.getComputedStyle(el);

    const copyText = (node: Text, pre: boolean, out: Node) => {
      const value = node.data;
      if (!pre) {
        out.appendChild(document.createTextNode(value.replace(/[\s\u00a0]+/g, (m) => (m.includes('\u00a0') ? '\u00a0' : ' '))));
        return;
      }
      // Preformatted text: keep line breaks and runs of spaces.
      value.split('\n').forEach((line, i) => {
        if (i > 0) out.appendChild(document.createElement('br'));
        const kept = line.replace(/\t/g, '    ').replace(/^ +| {2,}/g, (m) => '\u00a0'.repeat(m.length));
        if (kept) out.appendChild(document.createTextNode(kept));
      });
    };

    const isBlock = (n: Node | null) => {
      if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
      const d = style(n as Element).display;
      return d !== 'none' && !d.startsWith('inline') && d !== 'contents';
    };

    const walk = async (el: Element, out: HTMLElement) => {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const ws = style(el).whiteSpace;
          const pre = ws.startsWith('pre') || ws === 'break-spaces';
          // Indentation between block elements is not content; it would become empty paragraphs.
          if (!pre && !/[^\s]/.test((node as Text).data)) {
            const prev = node.previousSibling;
            const next = node.nextSibling;
            if (!prev || !next || isBlock(prev) || isBlock(next)) continue;
          }
          // The editor's reader takes text styles from inline elements only, so text directly
          // inside a block goes in a span carrying the block's look.
          let target: HTMLElement = out;
          if (out.tagName !== 'SPAN' && out.tagName !== 'A') {
            target = document.createElement('span');
            applyLook(target, style(el), 'SPAN', false);
            out.appendChild(target);
          }
          copyText(node as Text, pre, target);
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const child = node as Element;
        const tag = child.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        const cs = style(child);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;

        if (cs.breakBefore === 'page' || cs.pageBreakBefore === 'always') {
          const hr = document.createElement('hr');
          hr.className = 'doc-page-break';
          out.appendChild(hr);
        }

        if (tag === 'IMG') {
          const img = child as HTMLImageElement;
          const rect = img.getBoundingClientRect();
          if (!img.naturalWidth) {
            if (img.getAttribute('src')) missingImages++;
            const alt = img.getAttribute('alt');
            if (alt) out.appendChild(document.createTextNode(alt));
            continue;
          }
          const picture = await pictureOf(img, img.naturalWidth, img.naturalHeight, rect.width);
          if (picture) {
            const width = rect.width || img.naturalWidth;
            const height = rect.height || img.naturalHeight;
            const id = addImage(store, { ...picture, width: pxToPt(width), height: pxToPt(height) });
            const copy = document.createElement('img');
            copy.dataset.img = id;
            copy.style.width = `${pxToPt(width)}pt`;
            copy.style.height = `${pxToPt(height)}pt`;
            out.appendChild(copy);
          }
          continue;
        }
        if (tag === 'SVG') {
          const rect = child.getBoundingClientRect();
          const picture = rect.width && rect.height ? await svgPicture(child as SVGSVGElement, rect) : null;
          if (picture) {
            const id = addImage(store, { ...picture, width: pxToPt(rect.width), height: pxToPt(rect.height) });
            const copy = document.createElement('img');
            copy.dataset.img = id;
            copy.style.width = `${pxToPt(rect.width)}pt`;
            copy.style.height = `${pxToPt(rect.height)}pt`;
            out.appendChild(copy);
          }
          continue;
        }
        if (tag === 'BR') {
          out.appendChild(document.createElement('br'));
          continue;
        }
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          const input = child as HTMLInputElement;
          const type = (input.type || '').toLowerCase();
          if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue;
          const value =
            type === 'checkbox' || type === 'radio'
              ? input.checked ? '☑' : '☐'
              : tag === 'SELECT'
                ? ((child as HTMLSelectElement).selectedOptions[0]?.text ?? '')
                : input.value || input.placeholder || '';
          if (value) out.appendChild(document.createTextNode(` ${value} `));
          continue;
        }

        const block = !cs.display.startsWith('inline') && cs.display !== 'contents' && cs.display !== 'ruby';
        let outTag: string;
        if (tag === 'TFOOT') outTag = 'TBODY';
        else if (tag === 'CAPTION') outTag = 'P';
        else if (KEEP_BLOCK.has(tag)) outTag = tag;
        else if (INLINE_TAGS.has(tag) && !block) outTag = tag === 'A' ? 'A' : 'SPAN';
        else if (block) outTag = cs.display === 'list-item' ? 'P' : 'DIV';
        else outTag = 'SPAN';
        const copy = document.createElement(outTag);

        applyLook(copy, cs, tag, block);
        if (tag === 'A') {
          const href = (child as HTMLAnchorElement).getAttribute('href') ?? '';
          // Only links that work from a PDF: web and mail addresses, not the file's own anchors.
          if (/^(https?:|mailto:|tel:)/i.test(href)) copy.setAttribute('href', href);
        }
        if (tag === 'TD' || tag === 'TH') {
          const span = (child as HTMLTableCellElement).colSpan;
          if (span > 1) (copy as HTMLTableCellElement).colSpan = span;
          if (tag === 'TH') copy.style.fontWeight = 'bold';
        }
        if (tag === 'OL' || tag === 'UL') {
          // Lists styled without markers are navigation menus and the like: plain lines read better.
          if (cs.listStyleType === 'none') {
            const div = document.createElement('div');
            await walk(child, div);
            Array.from(div.children).forEach((li) => {
              const p = document.createElement('p');
              p.append(...Array.from(li.childNodes));
              out.appendChild(p);
            });
            continue;
          }
        }
        await walk(child, copy);
        out.appendChild(copy);
        // A caption (read as a paragraph inside the table) goes above the table instead.
        if (tag === 'TABLE') copy.querySelectorAll(':scope > p').forEach((caption) => out.insertBefore(caption, copy));

        if (cs.breakAfter === 'page' || cs.pageBreakAfter === 'always') {
          const hr = document.createElement('hr');
          hr.className = 'doc-page-break';
          out.appendChild(hr);
        }
      }
    };

    await walk(doc.body, root);
    const model = htmlToDoc(root, store, page);
    // Leading and trailing empty paragraphs come from spacing elements; they only push content down.
    const isEmpty = (b: DocModel['blocks'][number]) =>
      b.type === 'paragraph' && b.runs.every((r) => r.type === 'text' && !r.text.trim());
    while (model.blocks.length > 1 && isEmpty(model.blocks[0])) model.blocks.shift();
    while (model.blocks.length > 1 && isEmpty(model.blocks[model.blocks.length - 1])) model.blocks.pop();
    // Collapse runs of blank paragraphs left by empty wrappers.
    model.blocks = model.blocks.filter((b, i, all) => !(isEmpty(b) && i > 0 && isEmpty(all[i - 1])));
    const warnings: string[] = [];
    if (missingImages) warnings.push(`${missingImages} picture${missingImages === 1 ? '' : 's'} linked from the web or a folder`);
    return { doc: model, warnings, missingImages };
  } finally {
    frame.remove();
    releaseImages(store);
  }
}

/** Opens a sandboxed copy of the file in the browser's print dialog, for an exact-looking PDF. */
export async function printHtml(source: string): Promise<void> {
  const frame = await loadFrame(prepare(source), 794, true);
  // Printing works on the frame's own window, which the sandbox keeps free of the file's scripts.
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 60_000);
}
