import { IMAGE_MIME } from '../../constants/formats';
import type { WatermarkJobRequest, WatermarkFormat } from '../../types/watermark';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../compression/queueRunner';
import {
  COMPOSITE_FEATHER,
  MASK_DILATE,
  contextWindow,
  dilateMask,
  featherAlpha,
  fractionToPixels,
  growGlowMask,
  maskBounds,
  maskDistance,
  rectHeight,
  rectWidth,
} from './geometry';
import { inpaintExemplar } from './inpaint';
import { lamaAvailable, runLama } from './lama';

const MAX_SIDE = 4096;
const DEBUG_MAGENTA = { r: 255, g: 0, b: 255 } as const;

export interface WatermarkOutput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  notes: string[];
  engine: 'webgpu' | 'wasm' | 'canvas';
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
    if (mime === 'image/avif') return { mime: IMAGE_MIME.png, label: 'PNG' };
    return { mime: IMAGE_MIME.png, label: 'PNG' };
  }
  return { mime: IMAGE_MIME[format], label: format === 'jpeg' ? 'JPG' : format.toUpperCase() };
}

function extractCrop(
  image: ImageData,
  window: { x0: number; y0: number; x1: number; y1: number },
  originalMask: Uint8Array,
  dilateMaskFull: Uint8Array,
) {
  const sw = window.x1 - window.x0;
  const sh = window.y1 - window.y0;
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  const orig = new Uint8Array(sw * sh);
  const dilated = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = window.y0 + y;
    for (let x = 0; x < sw; x++) {
      const sx = window.x0 + x;
      const src = (sy * image.width + sx) * 4;
      const dst = (y * sw + x) * 4;
      rgba[dst] = image.data[src];
      rgba[dst + 1] = image.data[src + 1];
      rgba[dst + 2] = image.data[src + 2];
      rgba[dst + 3] = image.data[src + 3];
      const fi = sy * image.width + sx;
      orig[y * sw + x] = originalMask[fi];
      dilated[y * sw + x] = dilateMaskFull[fi];
    }
  }
  return { rgba, orig, dilated, sw, sh };
}

function compositeCrop(
  image: ImageData,
  window: { x0: number; y0: number; x1: number; y1: number },
  filled: Uint8ClampedArray,
  originalMask: Uint8Array,
  sw: number,
  sh: number,
): void {
  const dist = maskDistance(originalMask, sw, sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const mi = y * sw + x;
      if (!originalMask[mi]) continue;
      const alpha = featherAlpha(dist[mi], COMPOSITE_FEATHER);
      if (alpha <= 0) continue;
      const src = mi * 4;
      const dst = ((window.y0 + y) * image.width + (window.x0 + x)) * 4;
      if (alpha >= 1) {
        image.data[dst] = filled[src];
        image.data[dst + 1] = filled[src + 1];
        image.data[dst + 2] = filled[src + 2];
        image.data[dst + 3] = filled[src + 3];
      } else {
        const inv = 1 - alpha;
        image.data[dst] = Math.round(filled[src] * alpha + image.data[dst] * inv);
        image.data[dst + 1] = Math.round(filled[src + 1] * alpha + image.data[dst + 1] * inv);
        image.data[dst + 2] = Math.round(filled[src + 2] * alpha + image.data[dst + 2] * inv);
        image.data[dst + 3] = Math.round(filled[src + 3] * alpha + image.data[dst + 3] * inv);
      }
    }
  }
}

/** Paint every masked pixel solid magenta (debug overlay). */
function paintDebugMask(image: ImageData, mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    image.data[o] = DEBUG_MAGENTA.r;
    image.data[o + 1] = DEBUG_MAGENTA.g;
    image.data[o + 2] = DEBUG_MAGENTA.b;
    image.data[o + 3] = 255;
    count++;
  }
  return count;
}

export async function removeWatermark(job: WatermarkJobRequest, onProgress: ProgressFn): Promise<WatermarkOutput> {
  const { file, mask, settings } = job;
  const notes: string[] = [];
  onProgress(null, 'Reading photo');

  // Decode with EXIF orientation applied so width/height match the oriented photo the mark editor
  // uses (MaskDialog also creates an oriented bitmap). Fraction rects are never mapped from the
  // on-screen CSS preview size.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new CompressionError('DECODE_FAILED', String(error));
  }

  try {
    const naturalWidth = bitmap.width;
    const naturalHeight = bitmap.height;
    let { width, height } = bitmap;
    if (width < 8 || height < 8) throw new CompressionError('DECODE_FAILED', 'image too small');

    let scale = 1;
    if (Math.max(width, height) > MAX_SIDE) {
      scale = MAX_SIDE / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      notes.push(`This photo is very large, so the watermark was removed at ${width} × ${height}.`);
    }

    onProgress(0.05, 'Preparing');
    const { c, ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);

    // Map 0..1 rect onto the oriented decode size (after optional downscale). Expand is in output pixels.
    const expandPx = Math.round(settings.expand * scale);
    const box = fractionToPixels(mask, width, height, expandPx);
    if (rectWidth(box) < 2 || rectHeight(box) < 2) throw new CompressionError('UNKNOWN', 'watermark region too small');

    notes.push(
      `Mask from oriented decode ${naturalWidth}×${naturalHeight}` +
        (scale < 1 ? ` → work size ${width}×${height}` : '') +
        `; rect (${mask.x.toFixed(3)}, ${mask.y.toFixed(3)}, ${mask.width.toFixed(3)}×${mask.height.toFixed(3)})` +
        ` → px [${box.x0},${box.y0}]–[${box.x1},${box.y1}] expand ${expandPx}px.`,
    );

    // Seed = marked rectangle after expand.
    const seedMask = new Uint8Array(width * height);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) seedMask[y * width + x] = 1;
    }

    // Soft sparkle glow: grow into brighter / lower-contrast neighbours beyond the hard edge.
    onProgress(0.08, 'Growing soft glow');
    const originalMask = growGlowMask(image.data, width, height, seedMask);
    const grown = originalMask.reduce((n, v) => n + v, 0) - seedMask.reduce((n, v) => n + v, 0);
    if (grown > 0) notes.push(`Glow grow added ${grown} px beyond the expanded rectangle.`);

    if (settings.debugMask) {
      onProgress(0.5, 'Debug mask');
      const painted = paintDebugMask(image, originalMask);
      ctx.putImageData(image, 0, 0);
      notes.unshift(
        `Debug mask: ${painted} px painted magenta (expand + glow). Inpainting skipped so you can check placement.`,
      );
      const blob = await c.convertToBlob({ type: 'image/png' });
      onProgress(1, 'Done');
      return { blob, mime: 'image/png', width, height, notes, engine: 'canvas' };
    }

    const dilated = dilateMask(originalMask, width, height, MASK_DILATE);
    const dilBounds = maskBounds(dilated, width, height);
    if (!dilBounds) throw new CompressionError('UNKNOWN', 'empty watermark mask');
    const window = contextWindow(dilBounds, width, height);
    const crop = extractCrop(image, window, originalMask, dilated);

    let filled: Uint8ClampedArray;
    let engine: WatermarkOutput['engine'] = 'canvas';

    if (lamaAvailable(job)) {
      try {
        const result = await runLama(job, crop.rgba, crop.dilated, crop.sw, crop.sh, onProgress);
        filled = result.rgba;
        engine = result.device;
        notes.push(...result.notes);
        notes.push('Filled with the LaMa inpainting model on your device.');
      } catch (error) {
        console.info('[ofctools] LaMa failed, using classical fill:', error);
        notes.push('The AI inpaint model could not run, so a classical fill was used.');
        onProgress(0.3, 'Removing watermark');
        const patch = new Uint8ClampedArray(crop.rgba);
        inpaintExemplar(patch, crop.sw, crop.sh, crop.orig);
        filled = patch;
        engine = 'canvas';
      }
    } else {
      notes.push('This build has no AI inpaint model, so a classical fill was used. Run `npm run model:inpaint` to enable LaMa.');
      onProgress(0.3, 'Removing watermark');
      const patch = new Uint8ClampedArray(crop.rgba);
      inpaintExemplar(patch, crop.sw, crop.sh, crop.orig);
      filled = patch;
    }

    onProgress(0.9, 'Blending');
    compositeCrop(image, window, filled, crop.orig, crop.sw, crop.sh);
    ctx.putImageData(image, 0, 0);

    const { mime } = resolveFormat(file, settings.format);
    const quality = mime === IMAGE_MIME.jpeg ? 0.92 : mime === IMAGE_MIME.webp ? 0.92 : undefined;
    const blob = await c.convertToBlob({ type: mime, quality });
    notes.push('Mark only the watermark — keep borders and important lines outside the box when you can.');

    onProgress(1, 'Done');
    return { blob, mime, width, height, notes, engine };
  } finally {
    bitmap.close();
  }
}
