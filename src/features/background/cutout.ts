import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import {
  GUIDED_FILTER_EPS,
  MODEL_INPUT_SIZE,
  compositeUnpremultiplied,
  guidedFilter,
  guidedFilterRadius,
  letterboxLayout,
  lumaFloat,
  matteBoundsFloat,
  resizeMatteFloatBicubic,
  smoothstepAlpha,
  unletterboxMatte,
  type LetterboxLayout,
} from './matte';
import { findSubject, MASK_SIZE as SIZE, type Device } from './model';

/** Larger photos are scaled down to this many pixels, which keeps canvases within browser limits. */
const MAX_PIXELS = 40_000_000;

/** Letterbox pad colour ≈ ImageNet mean so normalised padding is near zero for BiRefNet. */
const PAD_RGB = { r: 123, g: 116, b: 104 } as const;

const MIME = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' } as const;

/** Optional stage previews when debugMatte is on — which stage causes halo / seams / washout. */
export interface CutoutDebugBlobs {
  rawMatte: Blob;
  refinedMatte: Blob;
  onWhite: Blob;
  onDark: Blob;
}

export interface CutoutOutput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  notes: string[];
  device: Device;
  debug?: CutoutDebugBlobs;
}

function canvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CompressionError('ENCODE_UNSUPPORTED', 'no 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/**
 * Aspect-preserving letterbox into the model square (no stretch). Returns RGBA for the square
 * and the layout needed to crop the matte back.
 */
function letterboxPixels(source: ImageBitmap, srcW: number, srcH: number): {
  rgba: Uint8ClampedArray;
  layout: LetterboxLayout;
} {
  const layout = letterboxLayout(srcW, srcH, SIZE);
  const { ctx } = canvas(SIZE, SIZE);
  ctx.fillStyle = `rgb(${PAD_RGB.r}, ${PAD_RGB.g}, ${PAD_RGB.b})`;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(source, 0, 0, srcW, srcH, layout.padX, layout.padY, layout.contentW, layout.contentH);
  return { rgba: ctx.getImageData(0, 0, SIZE, SIZE).data, layout };
}

function flattenColor(settings: BackgroundJobRequest['settings']): 'transparent' | string {
  if (settings.background === 'transparent') return 'transparent';
  if (settings.background === 'white') return '#ffffff';
  return settings.color;
}

/** Greyscale visualisation of a float matte (0–1). */
async function mattePreviewBlob(alpha: Float32Array, width: number, height: number): Promise<Blob> {
  const { c, ctx } = canvas(width, height);
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, alpha[i])) * 255);
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/** Composite the cut-out onto a solid colour for debug comparison (does not mutate `rgba`). */
async function flatPreviewBlob(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  bg: string,
): Promise<Blob> {
  const copy = new Uint8ClampedArray(rgba);
  compositeUnpremultiplied(copy, alpha, width, height, { background: bg });
  const { c, ctx } = canvas(width, height);
  ctx.putImageData(new ImageData(copy, width, height), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
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

    // Single full-frame pass (no tiling) — avoids rectangular seam patches from tile edges.
    const { rgba: modelRgba, layout } = letterboxPixels(bitmap, width, height);
    const subject = await findSubject(job, modelRgba, onProgress);
    notes.push(...subject.notes);
    notes.push(
      `Letterboxed ${width}×${height} → ${layout.contentW}×${layout.contentH} inside ${MODEL_INPUT_SIZE}² (pad ${layout.padX},${layout.padY}); single-pass (no tiles).`,
    );

    onProgress(0.8, 'Upscaling matte');
    const cropped = unletterboxMatte(subject.alpha, layout);
    // Bicubic float upscale first — keep soft values, no threshold.
    const rawFull = resizeMatteFloatBicubic(cropped, layout.contentW, layout.contentH, width, height);
    // Contrast curve after upscale kills the wide soft halo without binary snapping.
    const contrasted = smoothstepAlpha(rawFull, 0.1, 0.9);

    onProgress(0.88, 'Refining edges');
    const { c, ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const radius = guidedFilterRadius(width);
    // Tight guided filter with the original photo as guide (eps ~5e-5).
    const refined = guidedFilter(
      lumaFloat(image.data, width, height),
      contrasted,
      width,
      height,
      radius,
      GUIDED_FILTER_EPS,
    );
    notes.push(`Guided filter radius ${radius} px (eps ${GUIDED_FILTER_EPS}) at ${width}×${height}.`);

    onProgress(0.93, 'Cutting out');
    // Work on a copy so debug can still show composites from the same matte + source RGB.
    const sourceRgba = new Uint8ClampedArray(image.data);
    compositeUnpremultiplied(image.data, refined, width, height, {
      background: flattenColor(settings),
    });
    ctx.putImageData(image, 0, 0);

    let debug: CutoutDebugBlobs | undefined;
    if (settings.debugMatte) {
      onProgress(0.96, 'Debug previews');
      debug = {
        rawMatte: await mattePreviewBlob(rawFull, width, height),
        refinedMatte: await mattePreviewBlob(refined, width, height),
        onWhite: await flatPreviewBlob(sourceRgba, refined, width, height, '#ffffff'),
        onDark: await flatPreviewBlob(sourceRgba, refined, width, height, '#1a1a1a'),
      };
      notes.unshift('Debug matte: raw (after bicubic), refined (smoothstep + guided), composites on white and dark.');
    }

    const box = matteBoundsFloat(refined, width, height);
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

    const format = settings.background === 'transparent' && settings.format === 'jpeg' ? 'png' : settings.format;
    const mime = MIME[format];
    const blob = await final.c.convertToBlob({ type: mime, quality: format === 'png' ? undefined : 0.92 });
    if (blob.type !== mime) {
      notes.push(
        `Your browser cannot write ${format.toUpperCase()}, so the result was saved as ${blob.type.split('/')[1].toUpperCase()}.`,
      );
    }
    notes.push('Matte: bicubic → smoothstep(0.1–0.9) → guided filter → blur-fusion FG (unpremultiplied RGBA).');
    return { blob, mime: blob.type, width: crop.w, height: crop.h, notes, device: subject.device, debug };
  } finally {
    bitmap.close();
  }
}
