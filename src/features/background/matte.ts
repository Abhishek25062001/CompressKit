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
 * Runs over the whole image in one pass; windows at the border cover only pixels inside it.
 * Uses four float buffers and one shared summed-area table (24 bytes per pixel in all).
 */
export function guidedFilter(
  guide: Float32Array,
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  eps = 1e-4,
): Float32Array {
  const n = width * height;
  const integral = new Float64Array((width + 1) * (height + 1));
  const meanI = boxFilter(guide, width, height, radius, new Float32Array(n), integral);
  const meanP = boxFilter(src, width, height, radius, new Float32Array(n), integral);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = guide[i] * guide[i];
    b[i] = guide[i] * src[i];
  }
  boxFilter(a, width, height, radius, a, integral);
  boxFilter(b, width, height, radius, b, integral);
  for (let i = 0; i < n; i++) {
    const varI = a[i] - meanI[i] * meanI[i];
    const covIP = b[i] - meanI[i] * meanP[i];
    const ai = covIP / (varI + eps);
    a[i] = ai;
    b[i] = meanP[i] - ai * meanI[i];
  }
  boxFilter(a, width, height, radius, a, integral);
  boxFilter(b, width, height, radius, b, integral);
  // meanP is no longer needed: it becomes the output.
  const out = meanP;
  for (let i = 0; i < n; i++) {
    const v = a[i] * guide[i] + b[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/**
 * Box filter via a summed-area table (O(1) per pixel). Windows are clipped at the image border and
 * divided by the pixels they actually cover. `out` may be `src` itself (the table is built first),
 * and `integral` ((width + 1) × (height + 1)) can be shared between calls to save allocations.
 */
export function boxFilter(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  out: Float32Array = new Float32Array(width * height),
  integral: Float64Array = new Float64Array((width + 1) * (height + 1)),
): Float32Array {
  if (radius <= 0) {
    if (out !== src) out.set(src);
    return out;
  }
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += src[y * width + x];
      const i = (y + 1) * (width + 1) + (x + 1);
      integral[i] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
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

/** Tuning for {@link estimateForeground}; defaults follow the paper's reference code (pymatting `estimate_fg_ml`). */
export interface ForegroundOptions {
  regularization?: number;
  gradientWeight?: number;
  /** Sweeps per level while both sides are at most `smallSize`. */
  smallIterations?: number;
  /** Sweeps per level on the larger levels. */
  bigIterations?: number;
  smallSize?: number;
}

/** Nearest-neighbour resize of interleaved RGB floats. */
function resizeNearestRgb(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const s = (sy * sw + sx) * 3;
      const d = (y * dw + x) * 3;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
    }
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Foreground colour F for every pixel, from C = α·F + (1 − α)·B with F and B kept smooth
 * (Germer et al., "Fast Multi-Level Foreground Estimation", 2020). It is solved coarse to fine
 * over the whole image, so every pixel gets an estimate from its surroundings at some scale.
 *
 * This replaces a box-window "blur fusion", whose background estimate fell to black wherever no
 * clearly-background pixel lay inside the square window (dense hair). There F = C / α turned
 * near-white, in patches with straight, axis-aligned edges. Returns interleaved RGB floats 0–1.
 */
export function estimateForeground(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  options: ForegroundOptions = {},
): Float32Array {
  const n = width * height;
  if (alpha.length !== n) throw new Error(`matte size ${alpha.length} ≠ ${n}`);
  const reg = options.regularization ?? 1e-5;
  const gradientWeight = options.gradientWeight ?? 1;
  const smallIterations = options.smallIterations ?? 10;
  const bigIterations = options.bigIterations ?? 2;
  const smallSize = options.smallSize ?? 32;

  const image = new Float32Array(n * 3);
  let mean0 = 0;
  let mean1 = 0;
  let mean2 = 0;
  for (let i = 0; i < n; i++) {
    image[i * 3] = rgba[i * 4] / 255;
    image[i * 3 + 1] = rgba[i * 4 + 1] / 255;
    image[i * 3 + 2] = rgba[i * 4 + 2] / 255;
    mean0 += image[i * 3];
    mean1 += image[i * 3 + 1];
    mean2 += image[i * 3 + 2];
  }
  let F: Float32Array = new Float32Array([mean0 / n, mean1 / n, mean2 / n]);
  let B: Float32Array = new Float32Array(F);
  let pw = 1;
  let ph = 1;
  const levels = Math.max(1, Math.ceil(Math.log2(Math.max(width, height))));

  for (let level = 0; level <= levels; level++) {
    const lw = level === levels ? width : Math.max(1, Math.round(width ** (level / levels)));
    const lh = level === levels ? height : Math.max(1, Math.round(height ** (level / levels)));
    const full = lw === width && lh === height;
    let img: Float32Array = image;
    let a: Float32Array = alpha;
    if (!full) {
      img = resizeNearestRgb(image, width, height, lw, lh);
      a = new Float32Array(lw * lh);
      for (let y = 0; y < lh; y++) {
        const sy = Math.min(height - 1, Math.floor((y * height) / lh));
        for (let x = 0; x < lw; x++) a[y * lw + x] = alpha[sy * width + Math.min(width - 1, Math.floor((x * width) / lw))];
      }
    }
    F = resizeNearestRgb(F, pw, ph, lw, lh);
    B = resizeNearestRgb(B, pw, ph, lw, lh);
    const iterations = lw <= smallSize && lh <= smallSize ? smallIterations : bigIterations;

    for (let it = 0; it < iterations; it++) {
      for (let y = 0; y < lh; y++) {
        const up = y > 0 ? y - 1 : y;
        const down = y < lh - 1 ? y + 1 : y;
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          const a0 = clamp01(a[i]);
          const a1 = 1 - a0;
          let a00 = a0 * a0;
          const a01 = a0 * a1;
          let a11 = a1 * a1;
          const c = i * 3;
          let f0 = a0 * img[c];
          let f1 = a0 * img[c + 1];
          let f2 = a0 * img[c + 2];
          let b0 = a1 * img[c];
          let b1 = a1 * img[c + 1];
          let b2 = a1 * img[c + 2];
          // Four neighbours; at the border the pixel itself stands in (clamped, no wrap or zero pad).
          const left = y * lw + (x > 0 ? x - 1 : x);
          const right = y * lw + (x < lw - 1 ? x + 1 : x);
          for (let k = 0; k < 4; k++) {
            const j = k === 0 ? left : k === 1 ? right : k === 2 ? up * lw + x : down * lw + x;
            const da = reg + gradientWeight * Math.abs(a0 - clamp01(a[j]));
            a00 += da;
            a11 += da;
            const q = j * 3;
            f0 += da * F[q];
            f1 += da * F[q + 1];
            f2 += da * F[q + 2];
            b0 += da * B[q];
            b1 += da * B[q + 1];
            b2 += da * B[q + 2];
          }
          const inv = 1 / (a00 * a11 - a01 * a01);
          const m00 = inv * a11;
          const m01 = -inv * a01;
          const m11 = inv * a00;
          F[c] = clamp01(m00 * f0 + m01 * b0);
          F[c + 1] = clamp01(m00 * f1 + m01 * b1);
          F[c + 2] = clamp01(m00 * f2 + m01 * b2);
          B[c] = clamp01(m01 * f0 + m11 * b0);
          B[c + 1] = clamp01(m01 * f1 + m11 * b1);
          B[c + 2] = clamp01(m01 * f2 + m11 * b2);
        }
      }
    }
    pw = lw;
    ph = lh;
  }
  return F;
}

function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/**
 * Writes the cut-out into `rgba`: **unpremultiplied** RGBA (colour = estimated foreground F,
 * alpha = matte) for a transparent background, or F·α + colour·(1 − α) on a solid one.
 * Fully opaque pixels keep the photo's own colour exactly.
 */
export function writeCutout(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  foreground: Float32Array,
  width: number,
  height: number,
  background: 'transparent' | string,
): void {
  const n = width * height;
  if (alpha.length !== n || foreground.length !== n * 3) throw new Error(`matte/foreground size ≠ ${n}`);
  const solid = background !== 'transparent';
  const [flatR, flatG, flatB] = solid ? parseHex(background) : [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = clamp01(alpha[i]);
    let r: number;
    let g: number;
    let b: number;
    if (a >= 1 - 1e-3) {
      a = 1;
      r = rgba[o];
      g = rgba[o + 1];
      b = rgba[o + 2];
    } else {
      if (a <= 1e-3) a = 0;
      r = foreground[i * 3] * 255;
      g = foreground[i * 3 + 1] * 255;
      b = foreground[i * 3 + 2] * 255;
    }
    if (solid) {
      rgba[o] = Math.round(r * a + flatR * (1 - a));
      rgba[o + 1] = Math.round(g * a + flatG * (1 - a));
      rgba[o + 2] = Math.round(b * a + flatB * (1 - a));
      rgba[o + 3] = 255;
    } else {
      rgba[o] = Math.round(r);
      rgba[o + 1] = Math.round(g);
      rgba[o + 2] = Math.round(b);
      rgba[o + 3] = Math.round(a * 255);
    }
  }
}

/** Estimates the foreground colour and writes the cut-out (see {@link estimateForeground}, {@link writeCutout}). */
export function compositeUnpremultiplied(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  options: { background: 'transparent' | string },
): void {
  writeCutout(rgba, alpha, estimateForeground(rgba, alpha, width, height), width, height, options.background);
}

/** An axis-aligned block of (nearly) one intermediate alpha value — the signature of tiled or block-wise processing. */
export interface AlphaRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Alpha of the block, 0–1. */
  value: number;
  pixels: number;
}

/**
 * Finds isolated axis-aligned rectangles of constant intermediate alpha: 4-connected regions whose
 * alpha stays within `tolerance` of one value strictly between `low` and `high`, at least
 * `minSide` px on each side and `minArea` px in all, and filling at least `minFill` of their
 * bounding box. A real soft edge varies continuously, so it never forms such a block.
 */
export function findConstantAlphaRectangles(
  alpha: Float32Array,
  width: number,
  height: number,
  options: { tolerance?: number; low?: number; high?: number; minSide?: number; minArea?: number; minFill?: number } = {},
): AlphaRectangle[] {
  const tolerance = options.tolerance ?? 1 / 255;
  const low = options.low ?? 0.02;
  const high = options.high ?? 0.98;
  const minSide = options.minSide ?? 4;
  const minArea = options.minArea ?? 24;
  const minFill = options.minFill ?? 0.9;
  const seen = new Uint8Array(width * height);
  const found: AlphaRectangle[] = [];
  const stack: number[] = [];
  for (let s = 0; s < alpha.length; s++) {
    const v = alpha[s];
    if (seen[s] || v <= low || v >= high) continue;
    seen[s] = 1;
    stack.push(s);
    let pixels = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    while (stack.length) {
      const p = stack.pop()!;
      pixels++;
      const x = p % width;
      const y = (p - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y < height - 1) visit(p + width);
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w >= minSide && h >= minSide && pixels >= minArea && pixels / (w * h) >= minFill) {
      found.push({ x: x0, y: y0, width: w, height: h, value: v, pixels });
    }

    function visit(q: number) {
      if (seen[q]) return;
      const a = alpha[q];
      if (a <= low || a >= high || Math.abs(a - v) > tolerance) return;
      seen[q] = 1;
      stack.push(q);
    }
  }
  return found;
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
