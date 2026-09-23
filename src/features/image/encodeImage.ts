import UPNG from 'upng-js';
import { IMAGE_MIME, MIME_LABEL } from '../../constants/formats';
import type { ToolMode } from '../../types/media';
import type { ImageTransform } from '../../types/resize';
import type { ImageSettings } from '../../types/settings';
import { CompressionError } from '../../utils/errors';
import { canvasToBlob, getContext, releaseCanvas, type AnyCanvas } from './canvas';
import { decodeImage } from './decode';
import { FULL_CROP, centeredCrop } from '../resize/resizeJob';
import { computeTargetSize, cropToCanvas, hasTransparency, renderToCanvas, type Size } from './resize';

type EncodableFormat = keyof typeof IMAGE_MIME;

export interface ImageEncodeInput {
  file: Blob;
  settings: ImageSettings;
  mode: ToolMode;
  transform?: ImageTransform;
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
    // No browser encodes HEIC. Its photos are closest to JPEG, which "same as original" then means.
    case 'image/heic':
    case 'image/heif':
      return 'jpeg';
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

/** JPEG has no alpha channel; without a backdrop, canvases encode transparent pixels as black. */
function flattenOnWhite(canvas: AnyCanvas): void {
  const ctx = getContext(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** Encodes the canvas once. Pixels are read fresh, because target-size fitting may shrink the canvas between calls. */
async function encodeCanvas(
  canvas: AnyCanvas,
  format: EncodableFormat,
  quality: number,
  support: { avif: boolean },
): Promise<{ blob: Blob; engine: string }> {
  const mime = IMAGE_MIME[format];
  try {
    if (format === 'png') {
      const data = readPixels(canvas);
      const buffer = UPNG.encode([data.data.buffer as ArrayBuffer], data.width, data.height, pngColorCount(quality));
      return { blob: new Blob([buffer], { type: mime }), engine: 'upng' };
    }
    if (format === 'avif' && !support.avif) {
      return { blob: await encodeAvifWasm(readPixels(canvas), quality), engine: 'wasm-avif' };
    }
    const q = format === 'avif' ? avifQuality(quality) / 100 : quality / 100;
    const blob = await canvasToBlob(canvas, mime, q);
    if (blob.type !== mime) throw new CompressionError('ENCODE_UNSUPPORTED', `canvas returned ${blob.type}`);
    return { blob, engine: 'canvas' };
  } catch (e) {
    if (e instanceof CompressionError) throw e;
    throw new CompressionError('OUT_OF_MEMORY', `encode failed: ${String(e)}`);
  }
}

const formatKB = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** Highest quality tried when fitting a size. Above this, files grow a lot for little visible gain. */
const FIT_MAX_QUALITY = 92;
/** Below this, JPEG turns visibly blocky; a smaller but clean picture is better, so dimensions shrink first. */
const FIT_PREFERRED_MIN_QUALITY = 40;
const FIT_MIN_QUALITY = 5;
/** Below this the picture is no longer useful, so fitting gives up and returns the smallest result. */
const FIT_MIN_SIDE = 64;

interface FitResult {
  blob: Blob;
  engine: string;
  quality: number;
  canvas: AnyCanvas;
  fitted: boolean;
}

/**
 * Finds the highest quality whose output fits `limit` bytes with a binary search. When even
 * quality 40 is too large, the picture is scaled down in proportion to the overshoot and the search
 * runs again. Qualities below 40 are only tried once the picture cannot shrink further. With
 * `keepSize` (exact output dimensions were asked for) only quality is lowered.
 * The returned canvas is the one that was encoded; the caller releases it.
 */
async function fitToSize(
  start: AnyCanvas,
  format: EncodableFormat,
  limit: number,
  support: { avif: boolean },
  onStage: (stage: string) => void,
  keepSize: boolean,
): Promise<FitResult> {
  let canvas = start;
  let minQuality = keepSize ? FIT_MIN_QUALITY : FIT_PREFERRED_MIN_QUALITY;
  for (let round = 0; ; round++) {
    onStage(`Fitting under ${formatKB(limit)}${round ? ` at ${canvas.width} × ${canvas.height}` : ''}`);
    let lo = minQuality;
    let hi = FIT_MAX_QUALITY;
    let best: { blob: Blob; engine: string; quality: number } | null = null;
    let smallest: { blob: Blob; engine: string; quality: number } | null = null;

    // Most photos fit at high quality on the first try, which skips the search entirely.
    const first = await encodeCanvas(canvas, format, hi, support);
    if (first.blob.size <= limit) return { ...first, quality: hi, canvas, fitted: true };
    hi--;
    while (lo <= hi) {
      const q = Math.round((lo + hi) / 2);
      const out = await encodeCanvas(canvas, format, q, support);
      if (out.blob.size <= limit) {
        best = { ...out, quality: q };
        lo = q + 1;
      } else {
        if (!smallest || out.blob.size < smallest.blob.size) smallest = { ...out, quality: q };
        hi = q - 1;
      }
    }
    if (best) return { ...best, canvas, fitted: true };

    const floor = smallest ?? { ...first, quality: FIT_MAX_QUALITY };
    const scale = Math.min(0.9, Math.sqrt(limit / floor.blob.size) * 0.95);
    const next: Size = {
      width: Math.max(1, Math.round(canvas.width * scale)),
      height: Math.max(1, Math.round(canvas.height * scale)),
    };
    if (keepSize || Math.min(next.width, next.height) < FIT_MIN_SIDE || round >= 8) {
      if (minQuality === FIT_MIN_QUALITY) return { ...floor, canvas, fitted: false };
      // Out of room to shrink: accept lower quality at this size.
      minQuality = FIT_MIN_QUALITY;
      continue;
    }
    const smaller = renderToCanvas(canvas, next);
    if (canvas !== start) releaseCanvas(canvas);
    canvas = smaller;
  }
}

/**
 * Re-encodes an image with the browser's own codecs. Runs inside the image worker when
 * OffscreenCanvas is available, and on the main thread otherwise.
 */
export async function encodeImage({ file, settings, mode, transform, support, onStage }: ImageEncodeInput): Promise<ImageEncodeOutput> {
  onStage('Decoding image');
  const bitmap = await decodeImage(file);

  const source = { width: bitmap.width, height: bitmap.height };
  if (source.width * source.height > MAX_PIXELS) {
    bitmap.close();
    throw new CompressionError('OUT_OF_MEMORY', 'image exceeds canvas pixel limit');
  }

  // Freehand transforms have no fixed size: the cropped area keeps its own pixels.
  const cropRect = transform
    ? (transform.crop ??
      (transform.width && transform.height ? centeredCrop(source.width, source.height, transform.width / transform.height) : FULL_CROP))
    : null;
  const target =
    transform && cropRect
      ? transform.width && transform.height
        ? { width: transform.width, height: transform.height }
        : {
            width: Math.max(1, Math.min(source.width, Math.round(cropRect.width * source.width))),
            height: Math.max(1, Math.min(source.height, Math.round(cropRect.height * source.height))),
          }
      : computeTargetSize(source, settings);
  const resized = !!transform || target.width !== source.width || target.height !== source.height;
  onStage(resized ? `${transform ? 'Cropping and resizing' : 'Resizing'} to ${target.width} × ${target.height}` : 'Preparing pixels');

  let canvas: AnyCanvas;
  try {
    canvas = cropRect ? cropToCanvas(bitmap, cropRect, target) : renderToCanvas(bitmap, target);
  } catch (e) {
    throw new CompressionError('OUT_OF_MEMORY', `render failed: ${String(e)}`);
  } finally {
    bitmap.close();
  }

  const notes: string[] = [];
  const sourceMime = file.type || 'image/png';
  const sourceFormat = sourceFormatOf(sourceMime);
  let format: EncodableFormat = settings.format === 'original' ? sourceFormat : settings.format;
  const limit = mode !== 'convert' && settings.targetKB ? settings.targetKB * 1024 : null;

  let alphaChecked: boolean | null = null;
  const alpha = () => (alphaChecked ??= sourceFormat !== 'jpeg' && hasTransparency(readPixels(canvas).data));

  // A PNG cannot be steered to a byte size, so fitting uses a lossy format instead. The resize tool
  // makes upload-form files, where JPEG is what forms accept, so it flattens rather than using WebP.
  if (limit && format === 'png') {
    format = mode === 'compress' && alpha() && support.webp ? 'webp' : 'jpeg';
    notes.push(`PNG can't be shrunk to an exact size, so this was saved as ${MIME_LABEL[IMAGE_MIME[format]]}.`);
  }
  if (format === 'jpeg' && alpha()) {
    if (mode !== 'compress' || (limit && !support.webp)) {
      // JPEG was asked for explicitly (or is the only way to hit the size), so do what image editors do.
      flattenOnWhite(canvas);
      alphaChecked = false;
      notes.push('JPEG has no transparency, so transparent areas were filled with white.');
    } else {
      // Never flatten transparency into JPEG when compressing. WebP keeps alpha and is still small.
      format = support.webp ? 'webp' : 'png';
      notes.push(`Kept transparency: saved as ${MIME_LABEL[IMAGE_MIME[format]]} instead of JPEG.`);
    }
  }
  if (format === 'webp' && !support.webp) {
    format = alpha() && !limit ? 'png' : 'jpeg';
    if (format === 'jpeg' && alpha()) flattenOnWhite(canvas);
    notes.push(`Your browser can't encode WebP, so this was saved as ${MIME_LABEL[IMAGE_MIME[format]]}.`);
  }

  const mime = IMAGE_MIME[format];
  const sameFormat = mime === sourceMime || (sourceMime === 'image/pjpeg' && mime === 'image/jpeg');

  // Already under the limit in the requested format: nothing to do.
  if (limit && sameFormat && !resized && file.size <= limit) {
    releaseCanvas(canvas);
    return {
      blob: file,
      mime: sourceMime,
      width: source.width,
      height: source.height,
      notes: [`This file is already under ${formatKB(limit)}, so the original was kept unchanged.`],
      engine: 'original',
      keptOriginal: true,
    };
  }

  let blob: Blob;
  let engine: string;
  let output: Size = target;
  try {
    if (limit) {
      const fit = await fitToSize(canvas, format, limit, support, onStage, !!transform);
      ({ blob, engine } = fit);
      output = { width: fit.canvas.width, height: fit.canvas.height };
      if (fit.canvas !== canvas) releaseCanvas(fit.canvas);
      if (fit.fitted) {
        notes.push(`Fits under ${formatKB(limit)} at quality ${fit.quality}.`);
        if (output.width !== target.width) notes.push(`Scaled down to ${output.width} × ${output.height} to fit the size limit.`);
      } else {
        notes.push(
          transform
            ? `Couldn't get under ${formatKB(limit)} at ${target.width} × ${target.height}, even at the lowest quality (${formatKB(blob.size)}).`
            : `Couldn't get under ${formatKB(limit)}. This is the smallest usable version (${formatKB(blob.size)}).`,
        );
      }
    } else {
      onStage(format === 'png' ? 'Optimizing PNG palette' : `Encoding ${MIME_LABEL[mime]}${format === 'avif' && !support.avif ? ' (WebAssembly)' : ''}`);
      ({ blob, engine } = await encodeCanvas(canvas, format, settings.quality, support));
    }
  } finally {
    releaseCanvas(canvas);
  }

  if (mode !== 'compress') {
    return { blob, mime, width: output.width, height: output.height, notes, engine, keptOriginal: false };
  }

  if (blob.size >= file.size && sameFormat && !resized && !limit) {
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

  return { blob, mime, width: output.width, height: output.height, notes, engine, keptOriginal: false };
}
