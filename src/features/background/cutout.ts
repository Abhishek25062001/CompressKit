import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import {
  GUIDED_FILTER_EPS,
  MODEL_INPUT_SIZE,
  estimateForeground,
  findConstantAlphaRectangles,
  guidedFilter,
  guidedFilterRadius,
  letterboxLayout,
  lumaFloat,
  matteBoundsFloat,
  resizeMatteFloatBicubic,
  smoothstepAlpha,
  unletterboxMatte,
  writeCutout,
  type LetterboxLayout,
} from './matte';
import { memlog } from './memlog';
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
  onBlack: Blob;
  onColor: Blob;
}

/** Saturated debug backdrop: leftover background colour or wrong foreground colour shows up at once against it. */
const DEBUG_COLOR = '#00ff00';

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
  const { c, ctx } = canvas(SIZE, SIZE);
  ctx.fillStyle = `rgb(${PAD_RGB.r}, ${PAD_RGB.g}, ${PAD_RGB.b})`;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(source, 0, 0, srcW, srcH, layout.padX, layout.padY, layout.contentW, layout.contentH);
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  freeCanvas(c);
  return { rgba, layout };
}

function flattenColor(settings: BackgroundJobRequest['settings']): 'transparent' | string {
  if (settings.background === 'transparent') return 'transparent';
  if (settings.background === 'white') return '#ffffff';
  return settings.color;
}

/** Greyscale visualisation of a float matte (0–1). */
/** Debug note: blocks of constant intermediate alpha per matte stage, in output pixels. */
function rectangleReport(stages: { name: string; alpha: Float32Array; width: number; height: number }[], outWidth: number): string {
  const parts = stages.map(({ name, alpha, width, height }) => {
    const found = findConstantAlphaRectangles(alpha, width, height);
    if (!found.length) return `${name}: none`;
    const s = outWidth / width;
    const r = found[0];
    const box = `x ${Math.round(r.x * s)}–${Math.round((r.x + r.width) * s)}, y ${Math.round(r.y * s)}–${Math.round((r.y + r.height) * s)}`;
    return `${name}: ${found.length} (first at ${box}, alpha ${r.value.toFixed(2)})`;
  });
  return `Constant-alpha rectangle check — ${parts.join('; ')}.`;
}

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
  foreground: Float32Array,
  width: number,
  height: number,
  bg: string,
): Promise<Blob> {
  const copy = new Uint8ClampedArray(rgba);
  writeCutout(copy, alpha, foreground, width, height, bg);
  const { c, ctx } = canvas(width, height);
  ctx.putImageData(new ImageData(copy, width, height), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

interface RefinedMatte {
  /** Final soft alpha at the output size. */
  refined: Float32Array;
  /** Intermediate stages, kept only for the debug view. */
  stages?: { cropped: Float32Array; rawFull: Float32Array; contrasted: Float32Array };
}

/**
 * Model square → output-size refined matte. The intermediates (cropped, upscaled, contrasted, luma)
 * live only in this function, so they can be collected before colour estimation allocates its own
 * buffers — unless the debug view needs them.
 */
function refineMatte(
  square: Float32Array,
  layout: LetterboxLayout,
  photo: Uint8ClampedArray,
  width: number,
  height: number,
  keepStages: boolean,
): RefinedMatte {
  const cropped = unletterboxMatte(square, layout);
  // Bicubic float upscale first — keep soft values, no threshold.
  const rawFull = resizeMatteFloatBicubic(cropped, layout.contentW, layout.contentH, width, height);
  // Contrast curve after upscale kills the wide soft halo without binary snapping.
  const contrasted = smoothstepAlpha(rawFull, 0.1, 0.9);
  // Tight guided filter with the original photo as guide (eps ~5e-5), whole image in one pass.
  const refined = guidedFilter(lumaFloat(photo, width, height), contrasted, width, height, guidedFilterRadius(width), GUIDED_FILTER_EPS);
  return { refined, stages: keepStages ? { cropped, rawFull, contrasted } : undefined };
}

/** Frees a canvas's pixels now rather than at the next garbage collection. */
function freeCanvas(c: OffscreenCanvas): void {
  c.width = 0;
  c.height = 0;
}

/**
 * Estimates edge colours, builds the debug previews and writes the cut-out into `photo`. The
 * foreground buffer (12 bytes per pixel) lives only inside this function.
 */
async function colourAndCut(
  photo: Uint8ClampedArray,
  refined: Float32Array,
  stages: RefinedMatte['stages'],
  layout: LetterboxLayout,
  width: number,
  height: number,
  settings: BackgroundJobRequest['settings'],
  notes: string[],
  onProgress: ProgressFn,
): Promise<{ debug?: CutoutDebugBlobs; foregroundBytes: number }> {
  onProgress(0.91, 'Estimating edge colours');
  // Whole-image, multi-level solve: every 0 < α < 1 pixel gets a foreground colour (no windows or tiles).
  const foreground = estimateForeground(photo, refined, width, height);

  let debug: CutoutDebugBlobs | undefined;
  if (stages) {
    onProgress(0.94, 'Debug previews');
    // Built before the cut-out overwrites `photo`, which they need as the source.
    debug = {
      rawMatte: await mattePreviewBlob(stages.rawFull, width, height),
      refinedMatte: await mattePreviewBlob(refined, width, height),
      onWhite: await flatPreviewBlob(photo, refined, foreground, width, height, '#ffffff'),
      onBlack: await flatPreviewBlob(photo, refined, foreground, width, height, '#000000'),
      onColor: await flatPreviewBlob(photo, refined, foreground, width, height, DEBUG_COLOR),
    };
    notes.unshift(
      rectangleReport(
        [
          { name: 'model output', alpha: stages.cropped, width: layout.contentW, height: layout.contentH },
          { name: 'after upscale', alpha: stages.rawFull, width, height },
          { name: 'after smoothstep', alpha: stages.contrasted, width, height },
          { name: 'after guided filter (final)', alpha: refined, width, height },
        ],
        width,
      ),
    );
    notes.unshift('Debug matte: raw (after bicubic), refined (smoothstep + guided), composites on white, black and green.');
  }

  onProgress(0.97, 'Cutting out');
  writeCutout(photo, refined, foreground, width, height, flattenColor(settings));
  return { debug, foregroundBytes: foreground.byteLength };
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

  let width = bitmap.width;
  let height = bitmap.height;
  let c: OffscreenCanvas;
  let image: ImageData;
  let subject: Awaited<ReturnType<typeof findSubject>>;
  let layout: LetterboxLayout;
  try {
    if (width * height > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / (width * height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      notes.push(`This photo is very large, so the cut-out was made at ${width} × ${height}.`);
    }

    // Single full-frame pass (no tiling) — avoids rectangular seam patches from tile edges.
    const letterboxed = letterboxPixels(bitmap, width, height);
    layout = letterboxed.layout;
    subject = await findSubject(job, letterboxed.rgba, onProgress);

    const drawn = canvas(width, height);
    c = drawn.c;
    drawn.ctx.drawImage(bitmap, 0, 0, width, height);
    image = drawn.ctx.getImageData(0, 0, width, height);
  } finally {
    // The decoded photo is no longer needed once it is on the canvas.
    bitmap.close();
  }
  notes.push(
    `Letterboxed ${width}×${height} → ${layout.contentW}×${layout.contentH} inside ${MODEL_INPUT_SIZE}² (pad ${layout.padX},${layout.padY}); single-pass (no tiles).`,
  );

  onProgress(0.85, 'Refining edges');
  const { refined, stages } = refineMatte(subject.alpha, layout, image.data, width, height, settings.debugMatte);
  notes.push(`Guided filter radius ${guidedFilterRadius(width)} px (eps ${GUIDED_FILTER_EPS}) at ${width}×${height}.`);

  const { debug, foregroundBytes } = await colourAndCut(image.data, refined, stages, layout, width, height, settings, notes, onProgress);
  c.getContext('2d')!.putImageData(image, 0, 0);

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

  // Only a trimmed result needs a second canvas.
  let out = c;
  if (crop.w !== width || crop.h !== height) {
    out = canvas(crop.w, crop.h).c;
    out.getContext('2d')!.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  }

  const format = settings.background === 'transparent' && settings.format === 'jpeg' ? 'png' : settings.format;
  const mime = MIME[format];
  const blob = await out.convertToBlob({ type: mime, quality: format === 'png' ? undefined : 0.92 });
  memlog('after post-processing', {
    'photo RGBA': image.data.byteLength,
    'refined matte': refined.byteLength,
    'foreground (freed)': foregroundBytes,
    'canvas': width * height * 4,
    'result blob': blob.size,
  });
  freeCanvas(c);
  if (out !== c) freeCanvas(out);
  if (blob.type !== mime) {
    notes.push(
      `Your browser cannot write ${format.toUpperCase()}, so the result was saved as ${blob.type.split('/')[1].toUpperCase()}.`,
    );
  }
  notes.push('Matte: bicubic → smoothstep(0.1–0.9) → guided filter → multi-level FG colour (unpremultiplied RGBA).');
  return { blob, mime: blob.type, width: crop.w, height: crop.h, notes, device: subject.device, debug };
}
