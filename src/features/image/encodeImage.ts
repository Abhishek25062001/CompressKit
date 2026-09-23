import UPNG from 'upng-js';
import { IMAGE_MIME, MIME_LABEL } from '../../constants/formats';
import type { ToolMode } from '../../types/media';
import type { ImageSettings } from '../../types/settings';
import { CompressionError } from '../../utils/errors';
import { canvasToBlob, getContext, releaseCanvas, type AnyCanvas } from './canvas';
import { computeTargetSize, hasTransparency, renderToCanvas } from './resize';

type EncodableFormat = keyof typeof IMAGE_MIME;

export interface ImageEncodeInput {
  file: Blob;
  settings: ImageSettings;
  mode: ToolMode;
  support: { webp: boolean; avif: boolean };
  onStage: (stage: string) => void;
}

export interface ImageEncodeOutput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  notes: string[];
  engine: string;
  keptOriginal: boolean;
}

/** Canvas limits vary; beyond ~268 MP every major browser fails. */
const MAX_PIXELS = 268_000_000;

function sourceFormatOf(mime: string): EncodableFormat {
  switch (mime) {
    case 'image/jpeg':
    case 'image/pjpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    default:
      return 'png';
  }
}

function pngColorCount(quality: number): number {
  if (quality >= 90) return 0; // lossless
  if (quality >= 50) return 256;
  return 128;
}

function avifQuality(quality: number): number {
  return Math.min(90, Math.max(20, Math.round(quality - 25)));
}

async function encodeAvifWasm(imageData: ImageData, quality: number): Promise<Blob> {
  const { default: encode } = await import('@jsquash/avif/encode');
  const buffer = await encode(imageData, { quality: avifQuality(quality), speed: 6 });
  return new Blob([buffer], { type: 'image/avif' });
}

function readPixels(canvas: AnyCanvas): ImageData {
  return getContext(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Re-encodes an image with the browser's own codecs. Runs inside the image worker when
 * OffscreenCanvas is available, and on the main thread otherwise.
 */
/** JPEG has no alpha channel; without a backdrop, canvases encode transparent pixels as black. */
function flattenOnWhite(canvas: AnyCanvas): void {
  const ctx = getContext(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export async function encodeImage({ file, settings, mode, support, onStage }: ImageEncodeInput): Promise<ImageEncodeOutput> {
  onStage('Decoding image');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    throw new CompressionError('DECODE_FAILED', `createImageBitmap failed: ${String(e)}`);
  }

  const source = { width: bitmap.width, height: bitmap.height };
  if (source.width * source.height > MAX_PIXELS) {
    bitmap.close();
    throw new CompressionError('OUT_OF_MEMORY', 'image exceeds canvas pixel limit');
  }

  const target = computeTargetSize(source, settings);
  const resized = target.width !== source.width || target.height !== source.height;
  onStage(resized ? `Resizing to ${target.width} × ${target.height}` : 'Preparing pixels');

  let canvas: AnyCanvas;
  try {
    canvas = renderToCanvas(bitmap, target);
  } catch (e) {
    throw new CompressionError('OUT_OF_MEMORY', `render failed: ${String(e)}`);
  } finally {
    bitmap.close();
  }

  const notes: string[] = [];
  const sourceMime = file.type || 'image/png';
  const sourceFormat = sourceFormatOf(sourceMime);
  let format: EncodableFormat = settings.format === 'original' ? sourceFormat : settings.format;

  let pixels: ImageData | null = null;
  const pixelsNeeded = () => (pixels ??= readPixels(canvas));
  const mayHaveAlpha = sourceFormat !== 'jpeg';
  const alpha = () => mayHaveAlpha && hasTransparency(pixelsNeeded().data);

  if (format === 'jpeg' && alpha()) {
    if (mode === 'convert') {
      // The user asked for JPEG explicitly, so honor it the way image editors do.
      flattenOnWhite(canvas);
      pixels = null;
      notes.push('JPEG has no transparency, so transparent areas were filled with white.');
    } else {
      // Never flatten transparency into JPEG when compressing. WebP keeps alpha and is still small.
      format = support.webp ? 'webp' : 'png';
      notes.push(`Kept transparency: saved as ${MIME_LABEL[IMAGE_MIME[format]]} instead of JPEG.`);
    }
  }
  if (format === 'webp' && !support.webp) {
    format = alpha() ? 'png' : 'jpeg';
    notes.push(`Your browser can't encode WebP, so this was saved as ${MIME_LABEL[IMAGE_MIME[format]]}.`);
  }

  const mime = IMAGE_MIME[format];
  let blob: Blob;
  let engine = 'canvas';
  try {
    if (format === 'png') {
      onStage('Optimizing PNG palette');
      const data = pixelsNeeded();
      const cnum = pngColorCount(settings.quality);
      const buffer = UPNG.encode([data.data.buffer as ArrayBuffer], data.width, data.height, cnum);
      blob = new Blob([buffer], { type: mime });
      engine = 'upng';
    } else if (format === 'avif' && !support.avif) {
      onStage('Encoding AVIF (WebAssembly)');
      blob = await encodeAvifWasm(pixelsNeeded(), settings.quality);
      engine = 'wasm-avif';
    } else {
      onStage(`Encoding ${MIME_LABEL[mime]}`);
      const q = format === 'avif' ? avifQuality(settings.quality) / 100 : settings.quality / 100;
      blob = await canvasToBlob(canvas, mime, q);
      if (blob.type !== mime) throw new CompressionError('ENCODE_UNSUPPORTED', `canvas returned ${blob.type}`);
    }
  } catch (e) {
    if (e instanceof CompressionError) throw e;
    throw new CompressionError('OUT_OF_MEMORY', `encode failed: ${String(e)}`);
  } finally {
    pixels = null;
    releaseCanvas(canvas);
  }

  if (mode === 'convert') {
    return { blob, mime, width: target.width, height: target.height, notes, engine, keptOriginal: false };
  }

  const sameFormat = mime === sourceMime || (sourceMime === 'image/pjpeg' && mime === 'image/jpeg');
  if (blob.size >= file.size && sameFormat && !resized) {
    return {
      blob: file,
      mime: sourceMime,
      width: source.width,
      height: source.height,
      notes: ['This file is already well optimized, so the original was kept unchanged.'],
      engine: 'original',
      keptOriginal: true,
    };
  }
  if (blob.size >= file.size) {
    notes.push('The new file is not smaller than the original. Try a lower quality or a different format.');
  }

  return { blob, mime, width: target.width, height: target.height, notes, engine, keptOriginal: false };
}
