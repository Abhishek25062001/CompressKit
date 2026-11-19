import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import { applyMatteToRgba, matteBounds, refineMatteEdges, resizeMatteBicubic } from './matte';
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

function flattenColor(settings: BackgroundJobRequest['settings']): 'transparent' | string {
  if (settings.background === 'transparent') return 'transparent';
  if (settings.background === 'white') return '#ffffff';
  return settings.color;
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

    // Inference always at the model's fixed 1024×1024 input (verified from the ONNX graphs).
    const subject = await findSubject(job, squarePixels(bitmap), onProgress);
    notes.push(...subject.notes);

    onProgress(0.85, 'Refining edges');
    const refined = refineMatteEdges(subject.alpha, SIZE, SIZE);

    onProgress(0.9, 'Upscaling matte');
    // Bicubic upscale to the full-resolution work size, then apply as alpha (not CSS preview size).
    const fullMatte = resizeMatteBicubic(refined, SIZE, SIZE, width, height);

    onProgress(0.93, 'Cutting out');
    const { c, ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    applyMatteToRgba(image.data, fullMatte, width, height, { background: flattenColor(settings) });
    ctx.putImageData(image, 0, 0);

    const box = matteBounds(fullMatte, width, height);
    if (!box) notes.push('No clear subject was found in this photo, so most of it may have been removed.');
    let crop = { x: 0, y: 0, w: width, h: height };
    if (settings.trim && box) {
      const pad = Math.round(Math.max(width, height) * 0.02);
      const x = Math.max(0, box.x0 - pad);
      const y = Math.max(0, box.y0 - pad);
      crop = {
        x,
        y,
        w: Math.min(width, box.x1 + pad) - x,
        h: Math.min(height, box.y1 + pad) - y,
      };
    }

    const final = canvas(crop.w, crop.h);
    final.ctx.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    // PNG / WebP keep alpha when transparent; JPEG always flattens (applyMatteToRgba already did).
    const format = settings.background === 'transparent' && settings.format === 'jpeg' ? 'png' : settings.format;
    const mime = MIME[format];
    const blob = await final.c.convertToBlob({ type: mime, quality: format === 'png' ? undefined : 0.92 });
    if (blob.type !== mime) {
      notes.push(
        `Your browser cannot write ${format.toUpperCase()}, so the result was saved as ${blob.type.split('/')[1].toUpperCase()}.`,
      );
    }
    notes.push('Matte refined with a contrast curve and 1 px feather, then bicubic-upscaled to full resolution.');
    return { blob, mime: blob.type, width: crop.w, height: crop.h, notes, device: subject.device };
  } finally {
    bitmap.close();
  }
}
