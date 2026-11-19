/**
 * Crop / pad / composite math for LaMa inpainting. Pure functions so Node tests can run them
 * without a canvas or ONNX Runtime.
 */

export const LAMA_SIZE = 512;
/** Dilate the fill mask before the model so edges are covered; composite still uses the undilated mask. */
export const MASK_DILATE = 4;
/** Soft rim when pasting the model output back at full resolution. */
export const COMPOSITE_FEATHER = 2;
/** Context window is about this multiple of the mask side, and at least this many pixels. */
export const CONTEXT_SCALE = 3;
export const CONTEXT_MIN = 256;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function rectWidth(r: Rect): number {
  return Math.max(0, r.x1 - r.x0);
}

export function rectHeight(r: Rect): number {
  return Math.max(0, r.y1 - r.y0);
}

/** Axis-aligned bounds of non-zero mask pixels, or null when the mask is empty. */
export function maskBounds(mask: Uint8Array, width: number, height: number): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Morphological dilate by `radius` pixels (square structuring element). */
export function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/**
 * Context crop around the mask: roughly `CONTEXT_SCALE`× the longer mask side, at least
 * `CONTEXT_MIN`, centred on the mask, clamped to the image.
 */
export function contextWindow(bounds: Rect, imageWidth: number, imageHeight: number): Rect {
  const mw = rectWidth(bounds);
  const mh = rectHeight(bounds);
  const side = Math.max(CONTEXT_MIN, Math.ceil(Math.max(mw, mh) * CONTEXT_SCALE));
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  let x0 = Math.round(cx - side / 2);
  let y0 = Math.round(cy - side / 2);
  let x1 = x0 + side;
  let y1 = y0 + side;
  if (x0 < 0) {
    x1 -= x0;
    x0 = 0;
  }
  if (y0 < 0) {
    y1 -= y0;
    y0 = 0;
  }
  if (x1 > imageWidth) {
    x0 = Math.max(0, x0 - (x1 - imageWidth));
    x1 = imageWidth;
  }
  if (y1 > imageHeight) {
    y0 = Math.max(0, y0 - (y1 - imageHeight));
    y1 = imageHeight;
  }
  return { x0, y0, x1, y1 };
}

/** Reflect (mirror) an index into [0, length). */
export function reflectIndex(i: number, length: number): number {
  if (length <= 1) return 0;
  const period = 2 * (length - 1);
  let x = ((i % period) + period) % period;
  if (x >= length) x = period - x;
  return x;
}

/** How much to pad a `srcW`×`srcH` crop on each side to make a square of side `max(srcW, srcH)`. */
export function squarePad(srcW: number, srcH: number): { side: number; padX: number; padY: number } {
  const side = Math.max(srcW, srcH);
  return { side, padX: Math.floor((side - srcW) / 2), padY: Math.floor((side - srcH) / 2) };
}

/**
 * Feather weight for compositing: 0 at the outer rim of the original mask, 1 deeper inside.
 * `dist` is distance (px) from the nearest known (non-mask) pixel.
 */
export function featherAlpha(dist: number, feather = COMPOSITE_FEATHER): number {
  if (dist <= 0) return 0;
  if (feather <= 0 || dist >= feather) return 1;
  return dist / feather;
}

/**
 * Chamfer distance from each masked pixel to the nearest non-mask pixel.
 * Non-mask pixels get 0.
 */
export function maskDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const n = width * height;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let i = 0; i < n; i++) dist[i] = mask[i] ? INF : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + 1.414);
      if (x + 1 < width && y > 0) d = Math.min(d, dist[i - width + 1] + 1.414);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let d = dist[i];
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, dist[i + width] + 1);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, dist[i + width + 1] + 1.414);
      if (x > 0 && y + 1 < height) d = Math.min(d, dist[i + width - 1] + 1.414);
      dist[i] = d;
    }
  }
  return dist;
}

/** Fraction rect (0..1) → pixel rect on an image. */
export function fractionToPixels(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  expand: number,
): Rect {
  return {
    x0: Math.max(0, Math.floor(rect.x * width) - expand),
    y0: Math.max(0, Math.floor(rect.y * height) - expand),
    x1: Math.min(width, Math.ceil((rect.x + rect.width) * width) + expand),
    y1: Math.min(height, Math.ceil((rect.y + rect.height) * height) + expand),
  };
}
