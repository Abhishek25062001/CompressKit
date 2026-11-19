/**
 * Pure matte resize / edge refine / composite helpers for background removal.
 * Kept canvas-free so Node tests can exercise the math.
 */

/** Fixed side of both BiRefNet and IS-Net inputs/outputs (inspected ONNX: [1,3,1024,1024]). */
export const MODEL_INPUT_SIZE = 1024;

/** Cubic Hermite basis (Catmull–Rom / Keys with a = −0.5). */
function cubicWeight(t: number): number {
  const a = -0.5;
  const x = Math.abs(t);
  if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
  return 0;
}

function sampleNearest(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number {
  const xi = Math.min(sw - 1, Math.max(0, x));
  const yi = Math.min(sh - 1, Math.max(0, y));
  return src[yi * sw + xi];
}

/** Bilinear upsample/downsample of a single-channel matte. */
export function resizeMatteBilinear(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh);
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out;
  const xScale = sw / dw;
  const yScale = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1;
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.floor(sx);
      const x1 = x0 + 1;
      const fx = sx - x0;
      const v00 = sampleNearest(src, sw, sh, x0, y0);
      const v10 = sampleNearest(src, sw, sh, x1, y0);
      const v01 = sampleNearest(src, sw, sh, x0, y1);
      const v11 = sampleNearest(src, sw, sh, x1, y1);
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      out[y * dw + x] = Math.round(top + (bot - top) * fy);
    }
  }
  return out;
}

/** Bicubic upsample/downsample of a single-channel matte (preferred for soft edges). */
export function resizeMatteBicubic(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh);
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out;
  const xScale = sw / dw;
  const yScale = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const yBase = Math.floor(sy);
    const fy = sy - yBase;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const xBase = Math.floor(sx);
      const fx = sx - xBase;
      let sum = 0;
      let wSum = 0;
      for (let j = -1; j <= 2; j++) {
        const wy = cubicWeight(fy - j);
        if (wy === 0) continue;
        for (let i = -1; i <= 2; i++) {
          const wx = cubicWeight(fx - i);
          if (wx === 0) continue;
          const w = wx * wy;
          sum += sampleNearest(src, sw, sh, xBase + i, yBase + j) * w;
          wSum += w;
        }
      }
      out[y * dw + x] = Math.round(wSum > 0 ? sum / wSum : 0);
    }
  }
  return out;
}

/**
 * Light edge refinement at model resolution: S-curve contrast (pushes soft greys toward
 * 0/255) then a 1 px feather so the rim is not a hard stairstep.
 */
export function refineMatteEdges(alpha: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const contrasted = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    const t = alpha[i] / 255;
    // Smoothstep-ish S-curve centered on 0.5.
    const s = t * t * (3 - 2 * t);
    const boosted = t < 0.5 ? s * 0.85 : 0.15 + s * 0.85;
    contrasted[i] = Math.round(Math.min(255, Math.max(0, boosted * 255)));
  }

  // 1 px feather: average with 4-neighbour mean so the cut rim softens by ~one pixel.
  const out = new Uint8ClampedArray(contrasted.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let sum = contrasted[i] * 4;
      let n = 4;
      if (x > 0) {
        sum += contrasted[i - 1];
        n++;
      }
      if (x + 1 < width) {
        sum += contrasted[i + 1];
        n++;
      }
      if (y > 0) {
        sum += contrasted[i - width];
        n++;
      }
      if (y + 1 < height) {
        sum += contrasted[i + width];
        n++;
      }
      // Blend original contrasted centre with neighbourhood (keeps detail, softens 1 px).
      out[i] = Math.round((contrasted[i] * 2 + sum / n) / 3);
    }
  }
  return out;
}

export interface CompositeOptions {
  /** 'transparent' keeps alpha; otherwise flatten onto this CSS hex (#rrggbb). */
  background: 'transparent' | string;
}

/**
 * Apply a full-resolution matte as alpha onto RGBA pixels (in place). When `background` is a
 * solid colour, flatten RGB onto that colour and set alpha to 255 (for JPEG).
 */
export function applyMatteToRgba(
  rgba: Uint8ClampedArray,
  matte: Uint8ClampedArray,
  width: number,
  height: number,
  options: CompositeOptions,
): void {
  const n = width * height;
  if (matte.length !== n) throw new Error(`matte size ${matte.length} ≠ ${n}`);
  if (options.background === 'transparent') {
    for (let i = 0; i < n; i++) rgba[i * 4 + 3] = matte[i];
    return;
  }
  const hex = options.background.replace('#', '');
  const br = parseInt(hex.slice(0, 2), 16);
  const bg = parseInt(hex.slice(2, 4), 16);
  const bb = parseInt(hex.slice(4, 6), 16);
  for (let i = 0; i < n; i++) {
    const a = matte[i] / 255;
    const o = i * 4;
    rgba[o] = Math.round(rgba[o] * a + br * (1 - a));
    rgba[o + 1] = Math.round(rgba[o + 1] * a + bg * (1 - a));
    rgba[o + 2] = Math.round(rgba[o + 2] * a + bb * (1 - a));
    rgba[o + 3] = 255;
  }
}

/** Bounding box of pixels with alpha above `threshold`, or null when empty. */
export function matteBounds(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= threshold) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
