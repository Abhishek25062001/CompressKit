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

/** Rec. 601 luminance 0–255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Grow a seed mask into the soft halo of a bright/sparkle watermark: neighbouring pixels that are
 * brighter than the local background, or smoother (lower contrast) while still at least as bright.
 * Stops after `maxRadius` pixels from the seed so dark borders are not swallowed.
 */
export function growGlowMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seed: Uint8Array,
  options?: { maxRadius?: number; brightnessLift?: number },
): Uint8Array {
  const maxRadius = options?.maxRadius ?? 24;
  const brightnessLift = options?.brightnessLift ?? 10;
  const out = new Uint8Array(seed);
  const dist = new Int16Array(width * height);
  dist.fill(-1);

  const queue: number[] = [];
  for (let i = 0; i < seed.length; i++) {
    if (!seed[i]) continue;
    dist[i] = 0;
    queue.push(i);
  }
  if (queue.length === 0) return out;

  const localOutside = (cx: number, cy: number): { mean: number; contrast: number; count: number } => {
    let sum = 0;
    let min = 255;
    let max = 0;
    let count = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        if (out[i]) continue; // only background / not-yet-grown
        const o = i * 4;
        const L = luminance(rgba[o], rgba[o + 1], rgba[o + 2]);
        sum += L;
        if (L < min) min = L;
        if (L > max) max = L;
        count++;
      }
    }
    return { mean: count ? sum / count : 0, contrast: count ? max - min : 0, count };
  };

  const localSelfContrast = (cx: number, cy: number): number => {
    let min = 255;
    let max = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        const L = luminance(rgba[o], rgba[o + 1], rgba[o + 2]);
        if (L < min) min = L;
        if (L > max) max = L;
      }
    }
    return max - min;
  };

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const d0 = dist[i];
    if (d0 < 0 || d0 >= maxRadius) continue;
    const x = i % width;
    const y = (i / width) | 0;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (out[ni] || dist[ni] >= 0) continue;
      const o = ni * 4;
      const L = luminance(rgba[o], rgba[o + 1], rgba[o + 2]);
      const bg = localOutside(nx, ny);
      if (bg.count < 3) continue;
      const selfC = localSelfContrast(nx, ny);
      const brighter = L >= bg.mean + brightnessLift;
      const softGlow = L >= bg.mean - 2 && selfC <= Math.max(8, bg.contrast * 0.55);
      if (!brighter && !softGlow) continue;
      out[ni] = 1;
      dist[ni] = d0 + 1;
      queue.push(ni);
    }
  }
  return out;
}
