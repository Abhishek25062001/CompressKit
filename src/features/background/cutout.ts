import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import { findSubject, MASK_SIZE as SIZE, type Device } from './model';

/** Larger photos are scaled down to this many pixels, which keeps canvases within browser limits. */
const MAX_PIXELS = 40_000_000;

const MIME = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' } as const;

export interface CutoutOutput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  notes: string[];
  device: Device;
}

function canvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CompressionError('ENCODE_UNSUPPORTED', 'no 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** The photo squeezed into the model's square, as RGBA pixels. */
function squarePixels(source: ImageBitmap): Uint8ClampedArray {
  const { ctx } = canvas(SIZE, SIZE);
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/** Bounding box of the subject in mask coordinates, or null when nothing was found. */
function subjectBox(alpha: Uint8ClampedArray): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = SIZE;
  let y0 = SIZE;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (alpha[y * SIZE + x] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export async function removeBackground(job: BackgroundJobRequest, onProgress: ProgressFn): Promise<CutoutOutput> {
  const { file, settings } = job;
  const notes: string[] = [];
  onProgress(null, 'Reading photo');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new CompressionError('DECODE_FAILED', String(error));
  }

  try {
    let { width, height } = bitmap;
    if (width * height > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / (width * height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      notes.push(`This photo is very large, so the cut-out was made at ${width} × ${height}.`);
    }

    const subject = await findSubject(job, squarePixels(bitmap), onProgress);
    notes.push(...subject.notes);

    onProgress(0.9, 'Cutting out');
    const mask = new ImageData(SIZE, SIZE);
    for (let i = 0; i < subject.alpha.length; i++) mask.data[i * 4 + 3] = subject.alpha[i];
    const maskCanvas = canvas(SIZE, SIZE);
    maskCanvas.ctx.putImageData(mask, 0, 0);

    // The photo at full size, keeping only what the mask covers (the mask is scaled up smoothly).
    const cut = canvas(width, height);
    cut.ctx.drawImage(bitmap, 0, 0, width, height);
    cut.ctx.globalCompositeOperation = 'destination-in';
    cut.ctx.drawImage(maskCanvas.c, 0, 0, width, height);

    const box = subjectBox(subject.alpha);
    if (!box) notes.push('No clear subject was found in this photo, so most of it may have been removed.');
    let crop = { x: 0, y: 0, w: width, h: height };
    if (settings.trim && box) {
      const sx = width / SIZE;
      const sy = height / SIZE;
      const pad = Math.round(Math.max(width, height) * 0.02);
      const x = Math.max(0, Math.floor(box.x0 * sx) - pad);
      const y = Math.max(0, Math.floor(box.y0 * sy) - pad);
      crop = { x, y, w: Math.min(width, Math.ceil(box.x1 * sx) + pad) - x, h: Math.min(height, Math.ceil(box.y1 * sy) + pad) - y };
    }

    const final = canvas(crop.w, crop.h);
    if (settings.background !== 'transparent') {
      final.ctx.fillStyle = settings.background === 'white' ? '#ffffff' : settings.color;
      final.ctx.fillRect(0, 0, crop.w, crop.h);
    }
    final.ctx.drawImage(cut.c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    const format = settings.background === 'transparent' && settings.format === 'jpeg' ? 'png' : settings.format;
    const mime = MIME[format];
    const blob = await final.c.convertToBlob({ type: mime, quality: format === 'png' ? undefined : 0.92 });
    // Browsers without a WebP encoder silently return PNG.
    if (blob.type !== mime) notes.push(`Your browser cannot write ${format.toUpperCase()}, so the result was saved as ${blob.type.split('/')[1].toUpperCase()}.`);
    return { blob, mime: blob.type, width: crop.w, height: crop.h, notes, device: subject.device };
  } finally {
    bitmap.close();
  }
}
