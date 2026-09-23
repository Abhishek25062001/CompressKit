import type { Worker } from 'tesseract.js';
import type { PdfPage, PdfSource } from '../../types/pdf';
import { releaseCanvas } from '../image/canvas';
import { decodeImage } from '../image/decode';
import { getOpenPdf } from './documents';
import { renderPage } from './render';

/** A recognized word, in pixels of the page image it was read from. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Recognized text for one page, measured on the page as it is displayed (after rotation). */
export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
  text: string;
}

/** Long side of the image Tesseract reads: about 300 DPI on an A4 page, where accuracy levels off. */
const OCR_LONG_SIDE = 3300;

let workerPromise: Promise<Worker> | null = null;
let onEngineProgress: ((ratio: number, stage: string) => void) | null = null;

/**
 * Starts Tesseract once. Its worker, WebAssembly core and English data are served by this site
 * (see vite.config.ts), so no text or image ever goes to another server.
 */
function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/core`,
      langPath: `${base}ocr/lang`,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onEngineProgress?.(m.progress, 'Reading text');
        else if (m.status.startsWith('loading')) onEngineProgress?.(m.progress, 'Loading text recognition (about 7 MB, once)');
      },
    });
  })().catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

/** True when a PDF page already has a real text layer, so reading it again would only add noise. */
export async function hasTextLayer(page: PdfPage, source: PdfSource): Promise<boolean> {
  if (source.kind !== 'pdf') return false;
  const pdfPage = await getOpenPdf(source.id).view.getPage(page.index + 1);
  const content = await pdfPage.getTextContent();
  const chars = content.items.reduce((n, item) => n + ('str' in item ? item.str.trim().length : 0), 0);
  return chars >= 20;
}

async function longSideOf(page: PdfPage, source: PdfSource): Promise<number> {
  if (source.kind === 'pdf') {
    const viewport = (await getOpenPdf(source.id).view.getPage(page.index + 1)).getViewport({ scale: 1 });
    return Math.max(viewport.width, viewport.height);
  }
  const bitmap = await decodeImage(source.file);
  const side = Math.max(bitmap.width, bitmap.height);
  bitmap.close();
  return side;
}

export async function recognizePage(
  page: PdfPage,
  source: PdfSource,
  onProgress: (ratio: number, stage: string) => void,
): Promise<OcrPage> {
  onEngineProgress = onProgress;
  const worker = await getWorker();
  const longSide = await longSideOf(page, source);
  // Photos are read at their own resolution (up to the cap); PDF pages are rendered to about 300 DPI.
  const scale = source.kind === 'image' ? Math.min(1, OCR_LONG_SIDE / longSide) : OCR_LONG_SIDE / longSide;
  const canvas = await renderPage(page, source, scale, page.rotation, '#ffffff', page.scan);
  try {
    const { data } = await worker.recognize(canvas as HTMLCanvasElement, {}, { blocks: true, text: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            const text = word.text.trim();
            if (text && word.confidence > 20) words.push({ text, ...word.bbox });
          }
        }
      }
    }
    return { width: canvas.width, height: canvas.height, words, text: data.text ?? '' };
  } finally {
    releaseCanvas(canvas);
    onEngineProgress = null;
  }
}
