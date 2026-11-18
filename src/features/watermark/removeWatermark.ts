import { IMAGE_MIME } from '../../constants/formats';
import type { CropRect } from '../../types/resize';
import type { WatermarkJobRequest, WatermarkFormat } from '../../types/watermark';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../compression/queueRunner';
import { inpaintTelea } from './telea';

/** Larger photos are scaled down before inpainting so the fill stays responsive. */
const MAX_SIDE = 4096;
/** How far outside the marked box the algorithm looks for colour samples. */
const SAMPLE_PAD = 24;

export interface WatermarkOutput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  notes: string[];
}

function canvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CompressionError('ENCODE_UNSUPPORTED', 'no 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

function resolveFormat(file: File, format: WatermarkFormat): { mime: string; label: string } {
  if (format === 'original') {
    const mime = file.type || 'image/png';
    if (mime === 'image/jpeg' || mime === 'image/pjpeg') return { mime: IMAGE_MIME.jpeg, label: 'JPG' };
    if (mime === 'image/webp') return { mime: IMAGE_MIME.webp, label: 'WebP' };
    if (mime === 'image/avif') return { mime: IMAGE_MIME.png, label: 'PNG' }; // browsers rarely encode AVIF here
    return { mime: IMAGE_MIME.png, label: 'PNG' };
  }
  return { mime: IMAGE_MIME[format], label: format === 'jpeg' ? 'JPG' : format.toUpperCase() };
}

/** Pixel bounds of the marked rectangle, expanded by `expand` pixels, clamped to the photo. */
function maskBounds(rect: CropRect, width: number, height: number, expand: number) {
  const x0 = Math.max(0, Math.floor(rect.x * width) - expand);
  const y0 = Math.max(0, Math.floor(rect.y * height) - expand);
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width) + expand);
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height) + expand);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export async function removeWatermark(job: WatermarkJobRequest, onProgress: ProgressFn): Promise<WatermarkOutput> {
  const { file, mask, settings } = job;
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
    if (width < 8 || height < 8) throw new CompressionError('DECODE_FAILED', 'image too small');

    if (Math.max(width, height) > MAX_SIDE) {
      const scale = MAX_SIDE / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      notes.push(`This photo is very large, so the watermark was removed at ${width} × ${height}.`);
    }

    onProgress(0.1, 'Preparing');
    const { c, ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);

    const box = maskBounds(mask, width, height, settings.expand);
    if (box.w < 2 || box.h < 2) throw new CompressionError('UNKNOWN', 'watermark region too small');

    // Work on a padded crop so Telea has enough known pixels around the mark.
    const sx0 = Math.max(0, box.x0 - SAMPLE_PAD);
    const sy0 = Math.max(0, box.y0 - SAMPLE_PAD);
    const sx1 = Math.min(width, box.x1 + SAMPLE_PAD);
    const sy1 = Math.min(height, box.y1 + SAMPLE_PAD);
    const sw = sx1 - sx0;
    const sh = sy1 - sy0;

    const crop = new Uint8ClampedArray(sw * sh * 4);
    const cropMask = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      const srcY = sy0 + y;
      for (let x = 0; x < sw; x++) {
        const srcX = sx0 + x;
        const src = (srcY * width + srcX) * 4;
        const dst = (y * sw + x) * 4;
        crop[dst] = image.data[src];
        crop[dst + 1] = image.data[src + 1];
        crop[dst + 2] = image.data[src + 2];
        crop[dst + 3] = image.data[src + 3];
        if (srcX >= box.x0 && srcX < box.x1 && srcY >= box.y0 && srcY < box.y1) {
          cropMask[y * sw + x] = 1;
        }
      }
    }

    onProgress(0.25, 'Removing watermark');
    const radius = Math.min(8, Math.max(3, Math.round(Math.min(box.w, box.h) / 8)));
    inpaintTelea(crop, sw, sh, cropMask, radius);

    onProgress(0.85, 'Writing photo');
    for (let y = 0; y < sh; y++) {
      const dstY = sy0 + y;
      for (let x = 0; x < sw; x++) {
        const dstX = sx0 + x;
        if (dstX < box.x0 || dstX >= box.x1 || dstY < box.y0 || dstY >= box.y1) continue;
        const src = (y * sw + x) * 4;
        const dst = (dstY * width + dstX) * 4;
        image.data[dst] = crop[src];
        image.data[dst + 1] = crop[src + 1];
        image.data[dst + 2] = crop[src + 2];
        image.data[dst + 3] = crop[src + 3];
      }
    }
    ctx.putImageData(image, 0, 0);

    const { mime } = resolveFormat(file, settings.format);
    const quality = mime === IMAGE_MIME.jpeg ? 0.92 : mime === IMAGE_MIME.webp ? 0.92 : undefined;
    const blob = await c.convertToBlob({ type: mime, quality });
    notes.push('Mark the watermark tightly for the cleanest result. Large or busy marks may leave a soft patch.');

    onProgress(1, 'Done');
    return { blob, mime, width, height, notes };
  } finally {
    bitmap.close();
  }
}
