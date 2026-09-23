import type { ImageSettings } from '../../types/settings';
import { createCanvas, getContext, releaseCanvas, type AnyCanvas } from './canvas';

export interface Size {
  width: number;
  height: number;
}

/** Fits the source inside the optional max box, keeping aspect ratio and never upscaling. */
export function computeTargetSize(source: Size, settings: ImageSettings): Size {
  if (settings.preserveResolution) return source;
  const sx = settings.maxWidth ? settings.maxWidth / source.width : Infinity;
  const sy = settings.maxHeight ? settings.maxHeight / source.height : Infinity;
  const scale = Math.min(1, sx, sy);
  if (scale >= 1) return source;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Draws the bitmap at the target size. Large reductions are done in halving steps, which avoids
 * the aliasing a single bilinear pass produces when shrinking by more than 2x.
 */
export function renderToCanvas(bitmap: ImageBitmap, target: Size): AnyCanvas {
  let source: CanvasImageSource = bitmap;
  let width = bitmap.width;
  let height = bitmap.height;
  let intermediate: AnyCanvas | null = null;

  while (width / 2 >= target.width && height / 2 >= target.height) {
    const nextW = Math.max(target.width, Math.floor(width / 2));
    const nextH = Math.max(target.height, Math.floor(height / 2));
    const step = createCanvas(nextW, nextH);
    getContext(step).drawImage(source, 0, 0, nextW, nextH);
    if (intermediate) releaseCanvas(intermediate);
    intermediate = step;
    source = step;
    width = nextW;
    height = nextH;
  }

  const out = createCanvas(target.width, target.height);
  getContext(out).drawImage(source, 0, 0, target.width, target.height);
  if (intermediate) releaseCanvas(intermediate);
  return out;
}

export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}
