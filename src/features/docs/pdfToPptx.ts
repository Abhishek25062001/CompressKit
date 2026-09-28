import type { PDFPageProxy } from 'pdfjs-dist';
import { createId } from '../../utils/id';
import { canvasToBlob, releaseCanvas } from '../image/canvas';
import { writePptx, type Slide, type SlideRun, type SlideTextBox } from '../office/pptxWrite';
import { closePdf, loadPdfjs, openPdf } from '../pdf/documents';
import { stripText } from '../pdf/stripText';
import { pageTextBlocks, type BlockPiece, type TextBlock } from './pdfExtract';

/**
 * PDF to PowerPoint. Each page becomes a slide. In editable mode the slide's background is the page
 * with its text taken out (photos, drawings and colours stay exactly as they were) and the text is
 * put back on top as real PowerPoint text boxes, in place, with its font, size, weight and colour.
 * In picture mode each slide is a sharp image of the page, which looks identical but cannot be edited.
 */

export interface PptxOptions {
  mode: 'editable' | 'pictures';
  /** Resolution of slide pictures. */
  dpi: number;
  password?: string;
  onProgress?: (ratio: number, stage?: string) => void;
}

export interface PptxResult {
  blob: Blob;
  pages: number;
  /** Pages with no text to edit (scans), kept as pictures in editable mode. */
  pictureOnly: number;
}

async function renderCanvas(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  return canvas;
}

/** True when a render is (almost) blank paper, so it need not be kept as a picture. */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(4, Math.floor(data.length / 4 / 40000)) * 4;
  for (let i = 0; i < data.length; i += step) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
  return true;
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * The colour of a piece of text, read from the rendered page: within the text's box, the colour
 * furthest from the box's most common colour (the paper or background behind it).
 */
function inkColor(pixels: ImageData, scale: number, p: BlockPiece, angle = 0): string {
  // Samples across the text's box, turned with the text: along its baseline, and up to its cap height.
  const rad = (angle * Math.PI) / 180;
  const along = [Math.cos(rad), Math.sin(rad)];
  const up = [Math.sin(rad), -Math.cos(rad)];
  const samples: [number, number, number][] = [];
  const stepsAlong = Math.max(2, Math.min(60, Math.round(p.width * scale)));
  const stepsUp = Math.max(2, Math.min(12, Math.round(p.size * scale * 0.75)));
  for (let a = 0; a <= stepsAlong; a++) {
    for (let u = 0; u <= stepsUp; u++) {
      const dist = (a / stepsAlong) * p.width;
      const lift = (u / stepsUp) * p.size * 0.75;
      const x = Math.round((p.x + along[0] * dist + up[0] * lift) * scale);
      const y = Math.round((p.y + along[1] * dist + up[1] * lift) * scale);
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue;
      const i = (y * pixels.width + x) * 4;
      samples.push([pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]]);
    }
  }
  if (!samples.length) return '000000';
  const counts = new Map<string, { n: number; c: [number, number, number] }>();
  for (const c of samples) {
    const key = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { n: 1, c });
  }
  const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].c;
  let best = samples[0];
  let bestDist = -1;
  for (const c of samples) {
    const d = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  // Anti-aliased text never quite reaches its colour; a faint result means black or near it.
  return bestDist < 900 ? '000000' : `${hex(best[0])}${hex(best[1])}${hex(best[2])}`;
}

/**
 * Whether removing the text changes how the page looks where the text is. Samples a grid inside
 * each word's box; visible text changes a fair share of those pixels.
 */
function textIsVisible(withText: ImageData, withoutText: ImageData, scale: number, pieces: BlockPiece[]): boolean {
  let samples = 0;
  let changed = 0;
  for (const p of pieces) {
    const x0 = Math.max(0, Math.floor(p.x * scale));
    const x1 = Math.min(withText.width - 1, Math.ceil((p.x + p.width) * scale));
    const y0 = Math.max(0, Math.floor((p.y - p.size * 0.75) * scale));
    const y1 = Math.min(withText.height - 1, Math.ceil(p.y * scale));
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const i = (y * withText.width + x) * 4;
        samples++;
        const d = Math.abs(withText.data[i] - withoutText.data[i]) + Math.abs(withText.data[i + 1] - withoutText.data[i + 1]) + Math.abs(withText.data[i + 2] - withoutText.data[i + 2]);
        if (d > 60) changed++;
      }
    }
  }
  return samples > 0 && changed / samples > 0.02;
}

function textBoxes(blocks: TextBlock[], pixels: ImageData, sampleScale: number, place: (x: number, y: number) => { x: number; y: number }, s: number): SlideTextBox[] {
  return blocks.map((b) => {
    const size = Math.max(...b.lines.flat().map((p) => p.size));
    const lines: SlideRun[][] = b.lines.map((line) => {
      const runs: SlideRun[] = [];
      for (const p of line) {
        const run: SlideRun = {
          text: p.text,
          size: Math.round(p.size * s * 2) / 2,
          bold: p.bold || undefined,
          italic: p.italic || undefined,
          font: p.font,
          color: inkColor(pixels, sampleScale, p, b.angle),
        };
        const last = runs[runs.length - 1];
        if (last && last.size === run.size && last.bold === run.bold && last.italic === run.italic && last.font === run.font && last.color === run.color) last.text += run.text;
        else runs.push(run);
      }
      return runs;
    });
    const spacing = b.lines.length > 1 ? b.lineSpacing : size * 1.2;
    const width = (b.right - b.left) * s + size * s * 0.6;
    const height = spacing * b.lines.length * s;
    if (b.angle) {
      // Turned text: the box is placed so that, turned around its centre, it starts at the text's origin.
      const rad = (b.angle * Math.PI) / 180;
      const w = (b.right - b.left) * s;
      const h = size * 1.2 * s;
      const origin = place(b.left, b.firstBaseline);
      const vx = w / 2;
      const vy = -size * 0.36 * s;
      const cx = origin.x + vx * Math.cos(rad) - vy * Math.sin(rad);
      const cy = origin.y + vx * Math.sin(rad) + vy * Math.cos(rad);
      return { x: cx - w / 2, y: cy - h / 2, width: w + size * s * 0.3, height: h, lines, lineSpacing: size * 1.2 * s, rotation: b.angle };
    }
    const top = place(b.left, b.firstBaseline - spacing * 0.8);
    return { x: top.x, y: top.y, width, height, lines, lineSpacing: spacing * s };
  });
}

export async function pdfToPptx(file: File, options: PptxOptions): Promise<PptxResult> {
  const progress = options.onProgress ?? (() => undefined);
  const sourceId = createId();
  const opened = await openPdf(sourceId, file, options.password);
  const pdfjs = await loadPdfjs();
  let stripped: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;
  try {
    const numPages = opened.view.numPages;
    if (options.mode === 'editable') {
      progress(0.02, 'Separating text from pictures');
      const bytes = await stripText(new Uint8Array(await file.arrayBuffer()), options.password);
      stripped = await pdfjs.getDocument({ data: bytes }).promise;
    }
    const first = (await opened.view.getPage(1)).getViewport({ scale: 1 });
    const slideW = first.width;
    const slideH = first.height;
    const slides: Slide[] = [];
    let pictureOnly = 0;
    const scale = options.dpi / 72;

    for (let n = 1; n <= numPages; n++) {
      progress(0.05 + ((n - 1) / numPages) * 0.9, `Making slide ${n} of ${numPages}`);
      const page = await opened.view.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      // A page of another size is scaled to fit the slide, centred.
      const s = Math.min(slideW / viewport.width, slideH / viewport.height);
      const offX = (slideW - viewport.width * s) / 2;
      const offY = (slideH - viewport.height * s) / 2;
      const place = (x: number, y: number) => ({ x: offX + x * s, y: offY + y * s });
      const full = { x: offX, y: offY, width: viewport.width * s, height: viewport.height * s };

      if (options.mode === 'pictures') {
        const canvas = await renderCanvas(page, scale);
        const data = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
        releaseCanvas(canvas);
        slides.push({ pictures: [{ ...full, data, mime: 'image/jpeg' }], texts: [] });
        page.cleanup();
        continue;
      }

      const blocks = await pageTextBlocks(page, viewport);
      const pieces = blocks.flatMap((b) => b.lines.flat()).filter((pc) => pc.text.trim());
      // Text colours are read from the page as it looks; 1.5× is plenty to tell colours apart.
      const sampleScale = 1.5;
      const look = await renderCanvas(page, sampleScale);
      const pixels = look.getContext('2d')!.getImageData(0, 0, look.width, look.height);
      releaseCanvas(look);
      page.cleanup();
      const bgPage = await stripped!.getPage(n);

      // A page is kept as a picture when it has no text, or only invisible text: a searchable scan,
      // whose recognized words sit unseen over the scanned image. Editable boxes would show the
      // words twice, so the page is compared with and without its text where the words are.
      let pictureSlide = pieces.length === 0;
      if (!pictureSlide) {
        const bare = await renderCanvas(bgPage, sampleScale);
        const barePixels = bare.getContext('2d')!.getImageData(0, 0, bare.width, bare.height);
        releaseCanvas(bare);
        pictureSlide = !textIsVisible(pixels, barePixels, sampleScale, pieces);
      }
      if (pictureSlide) {
        bgPage.cleanup();
        const canvas = await renderCanvas(page, scale);
        const data = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
        releaseCanvas(canvas);
        page.cleanup();
        slides.push({ pictures: [{ ...full, data, mime: 'image/jpeg' }], texts: [] });
        pictureOnly++;
        continue;
      }
      const bg = await renderCanvas(bgPage, scale);
      bgPage.cleanup();
      const pictures: Slide['pictures'] = [];
      if (!isBlank(bg)) pictures.push({ ...full, data: new Uint8Array(await (await canvasToBlob(bg, 'image/jpeg', 0.9)).arrayBuffer()), mime: 'image/jpeg' });
      releaseCanvas(bg);
      slides.push({ pictures, texts: textBoxes(blocks, pixels, sampleScale, place, s) });
    }
    progress(0.97, 'Writing presentation');
    return { blob: writePptx(slides, slideW, slideH, file.name.replace(/\.pdf$/i, '')), pages: numPages, pictureOnly };
  } finally {
    closePdf(sourceId);
    void stripped?.loadingTask.destroy();
  }
}
