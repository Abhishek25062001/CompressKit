/**
 * Letterbox / float-matte resize / composite helpers for background removal.
 * Canvas-free so Node tests can exercise the math.
 */

/** Fixed side of both BiRefNet and IS-Net inputs/outputs (inspected ONNX: [1,3,1024,1024]). */
export const MODEL_INPUT_SIZE = 1024;

/** Where the photo sits inside the model's square after aspect-preserving letterbox. */
export interface LetterboxLayout {
  side: number;
  /** Content width/height inside the square (not including pad). */
  contentW: number;
  contentH: number;
  padX: number;
  padY: number;
  /** contentW / srcW (== contentH / srcH). */
  scale: number;
}

/**
 * Aspect-preserving fit of `srcW`×`srcH` into a `side`×`side` square with letterbox padding.
 * Never stretches: one axis is padded.
 */
export function letterboxLayout(srcW: number, srcH: number, side = MODEL_INPUT_SIZE): LetterboxLayout {
  if (srcW <= 0 || srcH <= 0 || side <= 0) {
    return { side, contentW: 0, contentH: 0, padX: 0, padY: 0, scale: 0 };
  }
  const scale = Math.min(side / srcW, side / srcH);
  const contentW = Math.max(1, Math.round(srcW * scale));
  const contentH = Math.max(1, Math.round(srcH * scale));
  return {
    side,
    contentW,
    contentH,
    padX: Math.floor((side - contentW) / 2),
    padY: Math.floor((side - contentH) / 2),
    scale,
  };
}

/**
 * Crop the letterbox padding out of a square matte, returning a contentW×contentH float alpha (0–1).
 */
export function unletterboxMatte(
  square: Float32Array,
  layout: LetterboxLayout,
): Float32Array {
  const { side, contentW, contentH, padX, padY } = layout;
  const out = new Float32Array(contentW * contentH);
  for (let y = 0; y < contentH; y++) {
    const srcRow = (padY + y) * side + padX;
    const dstRow = y * contentW;
    for (let x = 0; x < contentW; x++) out[dstRow + x] = square[srcRow + x];
  }
  return out;
}

/** Gentle smoothstep on float alpha — softens without binary thresholding. */
export function smoothstepAlpha(alpha: Float32Array, edge0 = 0.05, edge1 = 0.95): Float32Array {
  const out = new Float32Array(alpha.length);
  const denom = edge1 - edge0 || 1;
  for (let i = 0; i < alpha.length; i++) {
    let t = (alpha[i] - edge0) / denom;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

function clampSample(src: Float32Array, sw: number, sh: number, x: number, y: number): number {
  const xi = x < 0 ? 0 : x >= sw ? sw - 1 : x;
  const yi = y < 0 ? 0 : y >= sh ? sh - 1 : y;
  return src[yi * sw + xi];
}

function cubicWeight(t: number): number {
  const a = -0.5;
  const x = Math.abs(t);
  if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
  return 0;
}

/** Bilinear resize of a float matte (0–1). No quantization. */
export function resizeMatteFloatBilinear(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out;
  const xScale = sw / dw;
  const yScale = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const v00 = clampSample(src, sw, sh, x0, y0);
      const v10 = clampSample(src, sw, sh, x0 + 1, y0);
      const v01 = clampSample(src, sw, sh, x0, y0 + 1);
      const v11 = clampSample(src, sw, sh, x0 + 1, y0 + 1);
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      out[y * dw + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Bicubic resize of a float matte (0–1). Preferred for soft hair edges. */
export function resizeMatteFloatBicubic(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
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
          sum += clampSample(src, sw, sh, xBase + i, yBase + j) * w;
          wSum += w;
        }
      }
      const v = wSum > 0 ? sum / wSum : 0;
      out[y * dw + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/** Guided-filter radius ~6 px at 1536 px width, clamped to 4–8 (tighter = less halo / blockiness). */
export function guidedFilterRadius(imageWidth: number): number {
  return Math.max(4, Math.min(8, Math.round(6 * (imageWidth / 1536))));
}

/** Default guided-filter epsilon — small enough to keep hair edges. */
export const GUIDED_FILTER_EPS = 5e-5;

/** Rec. 601 luminance 0–1 from RGBA bytes. */
export function lumaFloat(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
  }
  return out;
}

/**
 * Fast guided filter (He et al.) with a grayscale guide. `src`/`guide` are float 0–1.
 * `eps` ~1e-4 keeps edges while smoothing flat regions — good for hair mattes.
 */
export function guidedFilter(
  guide: Float32Array,
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  eps = 1e-4,
): Float32Array {
  const meanI = boxFilter(guide, width, height, radius);
  const meanP = boxFilter(src, width, height, radius);
  const corrI = boxFilter(mul(guide, guide), width, height, radius);
  const corrIP = boxFilter(mul(guide, src), width, height, radius);
  const n = width * height;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIP = corrIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxFilter(a, width, height, radius);
  const meanB = boxFilter(b, width, height, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = meanA[i] * guide[i] + meanB[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i];
  return out;
}

/** Separable box filter via integral image (O(1) per pixel after prefix). */
export function boxFilter(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return new Float32Array(src);
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += src[y * width + x];
      const i = (y + 1) * (width + 1) + (x + 1);
      integral[i] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const A = integral[y0 * (width + 1) + x0];
      const B = integral[y0 * (width + 1) + (x1 + 1)];
      const C = integral[(y1 + 1) * (width + 1) + x0];
      const D = integral[(y1 + 1) * (width + 1) + (x1 + 1)];
      out[y * width + x] = (D - B - C + A) / area;
    }
  }
  return out;
}

/**
 * Blur-fusion foreground colour estimate for every pixel with 0 < alpha < 1, then write
 * **unpremultiplied** RGBA. Removes washed-out background colour fringing in hair / glass.
 */
export function compositeUnpremultiplied(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  options: { background: 'transparent' | string; blurRadius?: number },
): void {
  const n = width * height;
  if (alpha.length !== n) throw new Error(`matte size ${alpha.length} ≠ ${n}`);
  // Wide BG blur so thin hair strands still see a stable background colour estimate.
  const blurR = options.blurRadius ?? Math.max(16, Math.round(guidedFilterRadius(width) * 4));
  const fgBlurR = Math.max(8, Math.round(blurR * 0.6));

  const bgR = new Float32Array(n);
  const bgG = new Float32Array(n);
  const bgB = new Float32Array(n);
  const bgW = new Float32Array(n);
  const fgR = new Float32Array(n);
  const fgG = new Float32Array(n);
  const fgB = new Float32Array(n);
  const fgW = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const o = i * 4;
    // Strict known-BG / known-FG seeds so fringe pixels are reconstructed, not copied.
    if (a < 0.05) {
      bgR[i] = rgba[o];
      bgG[i] = rgba[o + 1];
      bgB[i] = rgba[o + 2];
      bgW[i] = 1;
    }
    if (a > 0.95) {
      fgR[i] = rgba[o];
      fgG[i] = rgba[o + 1];
      fgB[i] = rgba[o + 2];
      fgW[i] = 1;
    }
  }

  const bR = boxFilter(bgR, width, height, blurR);
  const bG = boxFilter(bgG, width, height, blurR);
  const bB = boxFilter(bgB, width, height, blurR);
  const bW = boxFilter(bgW, width, height, blurR);
  const fR = boxFilter(fgR, width, height, fgBlurR);
  const fG = boxFilter(fgG, width, height, fgBlurR);
  const fB = boxFilter(fgB, width, height, fgBlurR);
  const fW = boxFilter(fgW, width, height, fgBlurR);

  const solid = options.background !== 'transparent';
  let flatR = 255;
  let flatG = 255;
  let flatB = 255;
  if (solid) {
    const hex = options.background.replace('#', '');
    flatR = parseInt(hex.slice(0, 2), 16);
    flatG = parseInt(hex.slice(2, 4), 16);
    flatB = parseInt(hex.slice(4, 6), 16);
  }

  for (let i = 0; i < n; i++) {
    let a = alpha[i];
    if (a < 0) a = 0;
    else if (a > 1) a = 1;
    const o = i * 4;
    const cR = rgba[o];
    const cG = rgba[o + 1];
    const cB = rgba[o + 2];

    let outR: number;
    let outG: number;
    let outB: number;

    if (a <= 1e-3) {
      outR = cR;
      outG = cG;
      outB = cB;
      a = 0;
    } else if (a >= 1 - 1e-3) {
      outR = cR;
      outG = cG;
      outB = cB;
      a = 1;
    } else {
      // Estimated background colour near this pixel (blur-fusion).
      const bw = Math.max(bW[i], 1e-4);
      const estBR = bR[i] / bw;
      const estBG = bG[i] / bw;
      const estBB = bB[i] / bw;
      // C = a·F + (1−a)·B  →  F = (C − (1−a)·B) / a  (unpremultiply against estimated BG)
      const invA = 1 / Math.max(a, 0.02);
      let F_r = (cR - (1 - a) * estBR) * invA;
      let F_g = (cG - (1 - a) * estBG) * invA;
      let F_b = (cB - (1 - a) * estBB) * invA;
      // Blend toward blurred FG when available — stronger at low alpha where the solve is noisy.
      const fw = fW[i];
      if (fw > 0.02) {
        const trust = Math.min(1, fw) * (1 - a);
        const fr = fR[i] / fw;
        const fg = fG[i] / fw;
        const fb = fB[i] / fw;
        F_r = F_r * (1 - trust) + fr * trust;
        F_g = F_g * (1 - trust) + fg * trust;
        F_b = F_b * (1 - trust) + fb * trust;
      }
      outR = F_r < 0 ? 0 : F_r > 255 ? 255 : F_r;
      outG = F_g < 0 ? 0 : F_g > 255 ? 255 : F_g;
      outB = F_b < 0 ? 0 : F_b > 255 ? 255 : F_b;
    }

    if (solid) {
      rgba[o] = Math.round(outR * a + flatR * (1 - a));
      rgba[o + 1] = Math.round(outG * a + flatG * (1 - a));
      rgba[o + 2] = Math.round(outB * a + flatB * (1 - a));
      rgba[o + 3] = 255;
    } else {
      // Unpremultiplied RGBA for PNG/WebP.
      rgba[o] = Math.round(outR);
      rgba[o + 1] = Math.round(outG);
      rgba[o + 2] = Math.round(outB);
      rgba[o + 3] = Math.round(a * 255);
    }
  }
}

/** Bounding box of pixels with alpha above `threshold` (0–1), or null when empty. */
export function matteBoundsFloat(
  alpha: Float32Array,
  width: number,
  height: number,
  threshold = 0.1,
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

/** Convert 0–255 byte matte → float 0–1. */
export function bytesToFloatAlpha(bytes: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] / 255;
  return out;
}

/** Convert float 0–1 → 0–255 bytes (for debug / bounds helpers). */
export function floatAlphaToBytes(alpha: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = Math.round(alpha[i] * 255);
  return out;
}

// --- Back-compat wrappers used by older tests (byte mattes) ---

export function resizeMatteBilinear(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  return floatAlphaToBytes(resizeMatteFloatBilinear(bytesToFloatAlpha(src), sw, sh, dw, dh));
}

export function resizeMatteBicubic(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  return floatAlphaToBytes(resizeMatteFloatBicubic(bytesToFloatAlpha(src), sw, sh, dw, dh));
}

export function matteBounds(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
): { x0: number; y0: number; x1: number; y1: number } | null {
  return matteBoundsFloat(bytesToFloatAlpha(alpha), width, height, threshold / 255);
}
