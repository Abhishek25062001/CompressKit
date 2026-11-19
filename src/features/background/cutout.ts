import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import {
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

    // (1) Letterbox — never stretch. (2) Inference at MODEL_INPUT_SIZE (1024).
    const { rgba: modelRgba, layout } = letterboxPixels(bitmap, width, height);
    const subject = await findSubject(job, modelRgba, onProgress);
    notes.push(...subject.notes);
    notes.push(
      `Letterboxed ${width}×${height} → ${layout.contentW}×${layout.contentH} inside ${MODEL_INPUT_SIZE}² (pad ${layout.padX},${layout.padY}).`,
    );

    // (3) Crop pad, gentle smoothstep only (no binary threshold), bicubic upscale as float alpha.
    onProgress(0.82, 'Upscaling matte');
    const cropped = unletterboxMatte(subject.alpha, layout);
    const softened = smoothstepAlpha(cropped, 0.04, 0.96);
    let fullMatte = resizeMatteFloatBicubic(softened, layout.contentW, layout.contentH, width, height);

    // (4) Guided filter with the original photo as guide (runs in this worker).
    onProgress(0.88, 'Refining edges');
    const { c, ctx } = canvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const radius = guidedFilterRadius(width);
    fullMatte = guidedFilter(lumaFloat(image.data, width, height), fullMatte, width, height, radius, 1e-4);
    notes.push(`Guided filter radius ${radius} px (eps 1e-4) at ${width}×${height}.`);

    // (5) Blur-fusion FG colour for semi-transparent edges → unpremultiplied RGBA.
    onProgress(0.93, 'Cutting out');
    compositeUnpremultiplied(image.data, fullMatte, width, height, {
      background: flattenColor(settings),
      blurRadius: Math.max(4, Math.round(radius * 1.25)),
    });
    ctx.putImageData(image, 0, 0);

    const box = matteBoundsFloat(fullMatte, width, height);
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
    notes.push('Soft float matte (bicubic + guided filter + blur-fusion), no binary threshold.');
    return { blob, mime: blob.type, width: crop.w, height: crop.h, notes, device: subject.device };
  } finally {
    bitmap.close();
  }
}
