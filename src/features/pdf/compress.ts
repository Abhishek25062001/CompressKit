import type { PDFDict, PDFDocument, PDFObject, PDFRawStream as RawStream, PDFRef } from '@cantoo/pdf-lib';
import type { CompressLevel } from '../../types/pdf';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../image/canvas';
import { loadPdfjs } from './documents';

type Lib = typeof import('@cantoo/pdf-lib');

/** Longest side of a recompressed photo, and its JPEG quality. */
const LEVELS: Record<CompressLevel, { maxSide: number; quality: number }> = {
  light: { maxSide: 2400, quality: 0.8 },
  medium: { maxSide: 1600, quality: 0.65 },
  strong: { maxSide: 1100, quality: 0.5 },
};

/** Flattening steps tried after recompression when a size target is still not met: DPI and JPEG quality. */
const FLATTEN_STEPS = [
  { dpi: 150, quality: 0.7 },
  { dpi: 110, quality: 0.6 },
  { dpi: 80, quality: 0.5 },
];

export interface CompressResult {
  bytes: Uint8Array;
  /** How it got there, for the result message. */
  method: 'images' | 'flattened' | 'unchanged';
  level?: CompressLevel;
  photos: number;
}

/**
 * Only 8-bit JPEG photos in grayscale or RGB are rewritten. CMYK, custom decode arrays and masks
 * are left alone, because a browser canvas cannot reproduce them faithfully.
 */
function isRecompressible(lib: Lib, doc: PDFDocument, dict: PDFDict): boolean {
  const { PDFName, PDFArray, PDFNumber, PDFRawStream } = lib;
  const name = (key: string) => dict.get(PDFName.of(key));
  if (name('Subtype') !== PDFName.of('Image')) return false;
  if (name('ImageMask') || name('Decode') || name('Mask')) return false;
  let filter: PDFObject | undefined = name('Filter');
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : undefined;
  if (filter !== PDFName.of('DCTDecode')) return false;
  const bpc = name('BitsPerComponent');
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return false;
  const cs = doc.context.lookup(name('ColorSpace'));
  if (cs === PDFName.of('DeviceRGB') || cs === PDFName.of('DeviceGray')) return true;
  if (cs instanceof PDFArray && cs.get(0) === PDFName.of('ICCBased')) {
    const profile = doc.context.lookup(cs.get(1));
    const n = profile instanceof PDFRawStream ? profile.dict.get(PDFName.of('N')) : undefined;
    return n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3);
  }
  return false;
}

/** Rewrites every eligible JPEG photo smaller and lower quality. Text, vector drawings and fonts are untouched. */
async function recompressImages(bytes: Uint8Array, level: CompressLevel, onProgress: (r: number) => void): Promise<{ bytes: Uint8Array; photos: number }> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { maxSide, quality } = LEVELS[level];
  const images = doc.context
    .enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFRawStream && isRecompressible(lib, doc, obj.dict)) as [PDFRef, RawStream][];

  let photos = 0;
  for (let i = 0; i < images.length; i++) {
    const [ref, stream] = images[i];
    onProgress(i / Math.max(1, images.length));
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }));
    } catch {
      continue;
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    getContext(canvas).drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
    releaseCanvas(canvas);
    // Keep the original when re-encoding would not save at least 10%.
    if (jpeg.length > stream.contents.length * 0.9) continue;

    const dict = stream.dict.clone(doc.context);
    for (const key of ['Length', 'DecodeParms', 'Filter', 'ColorSpace', 'Width', 'Height']) dict.delete(PDFName.of(key));
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    dict.set(PDFName.of('Width'), PDFNumber.of(width));
    dict.set(PDFName.of('Height'), PDFNumber.of(height));
    doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
    photos++;
  }
  onProgress(1);
  return { bytes: await doc.save({ useObjectStreams: true }), photos };
}

/** Last resort: every page becomes one JPEG. Text is no longer selectable or searchable. */
async function flatten(bytes: Uint8Array, dpi: number, quality: number, onProgress: (r: number) => void): Promise<Uint8Array> {
  const [{ PDFDocument }, pdfjs] = await Promise.all([import('@cantoo/pdf-lib'), loadPdfjs()]);
  const view = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = await PDFDocument.create();
  out.setProducer('CompressKit');
  try {
    for (let i = 1; i <= view.numPages; i++) {
      const page = await view.getPage(i);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
      releaseCanvas(canvas);
      page.cleanup();
      const image = await out.embedJpg(jpeg);
      out.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
      onProgress(i / view.numPages);
    }
  } finally {
    void view.loadingTask.destroy();
  }
  return out.save({ useObjectStreams: true });
}

/**
 * Compresses at the chosen level. With a target, it steps through stronger levels and, when
 * allowed, flattening, stopping at the first result under the target.
 */
export async function compressPdfBytes(
  input: Uint8Array,
  options: { level: CompressLevel; targetBytes: number | null; allowFlatten: boolean },
  onProgress: (ratio: number, stage: string) => void,
): Promise<CompressResult> {
  const order: CompressLevel[] = ['light', 'medium', 'strong'];
  const levels = options.targetBytes ? order.slice(order.indexOf(options.level)) : [options.level];
  let best: CompressResult = { bytes: input, method: 'unchanged', photos: 0 };

  for (const level of levels) {
    const { bytes, photos } = await recompressImages(input, level, (r) => onProgress(r, `Recompressing photos (${level})`));
    if (bytes.length < best.bytes.length) best = { bytes, method: photos ? 'images' : 'unchanged', level, photos };
    if (!options.targetBytes || best.bytes.length <= options.targetBytes) return best;
  }
  if (options.targetBytes && options.allowFlatten) {
    for (const step of FLATTEN_STEPS) {
      const bytes = await flatten(input, step.dpi, step.quality, (r) => onProgress(r, `Flattening pages at ${step.dpi} DPI`));
      if (bytes.length < best.bytes.length) best = { bytes, method: 'flattened', photos: 0 };
      if (best.bytes.length <= options.targetBytes) break;
    }
  }
  return best;
}
