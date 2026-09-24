import type { BackgroundSettings } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import type { LoadedModel } from './model';

/** The model looks at the photo squeezed into a 1024 × 1024 square. */
const SIZE = 1024;
/** Larger photos are scaled down to this many pixels, which keeps canvases within browser limits. */
const MAX_PIXELS = 40_000_000;

const MIME = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' } as const;

export interface CutoutOutput {
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

/** Pixels as three planes of normalized floats: (value − 128) / 256, as the model was trained. */
function toTensorData(source: ImageBitmap): Float32Array {
  const { ctx } = canvas(SIZE, SIZE);
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] - 128) / 256;
    out[plane + i] = (rgba[i * 4 + 1] - 128) / 256;
    out[2 * plane + i] = (rgba[i * 4 + 2] - 128) / 256;
  }
  return out;
}

/** The model's 1024 × 1024 foreground map as an alpha-only image, stretched so its weakest and strongest values span 0–255. */
function toMask(values: Float32Array): { image: ImageData; alpha: Uint8ClampedArray } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Stretch only a real foreground map; a nearly flat one (no subject) is used as it is.
  if (max - min < 0.2) {
    min = 0;
    max = 1;
  }
  const range = max - min;
  const image = new ImageData(SIZE, SIZE);
  const alpha = new Uint8ClampedArray(SIZE * SIZE);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = ((values[i] - min) / range) * 255;
    image.data[i * 4 + 3] = alpha[i];
  }
  return { image, alpha };
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

export async function removeBackground(
  file: Blob,
  settings: BackgroundSettings,
  model: LoadedModel,
  onProgress: ProgressFn,
): Promise<CutoutOutput> {
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

    onProgress(null, model.device === 'webgpu' ? 'Finding the subject' : 'Finding the subject (no GPU, this takes about a minute)');
    const input = new model.ort.Tensor('float32', toTensorData(bitmap), [1, 3, SIZE, SIZE]);
    const results = await model.session.run({ [model.session.inputNames[0]]: input });
    input.dispose();
    const output = results[model.session.outputNames[0]];
    const values = (await output.getData()) as Float32Array;
    output.dispose();

    onProgress(0.9, 'Cutting out');
    const mask = toMask(values);
    const maskCanvas = canvas(SIZE, SIZE);
    maskCanvas.ctx.putImageData(mask.image, 0, 0);

    // The photo at full size, keeping only what the mask covers (the mask is scaled up smoothly).
    const cut = canvas(width, height);
    cut.ctx.drawImage(bitmap, 0, 0, width, height);
    cut.ctx.globalCompositeOperation = 'destination-in';
    cut.ctx.drawImage(maskCanvas.c, 0, 0, width, height);

    const box = subjectBox(mask.alpha);
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
    return { blob, mime: blob.type, width: crop.w, height: crop.h, notes };
  } finally {
    bitmap.close();
  }
}
