import type { ScanFilter, ScanSettings } from '../../types/pdf';
import { createCanvas, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';

type Point = [number, number];

/**
 * Projective transform from the unit square to a quadrilateral (Heckbert's square-to-quad), so a
 * photographed page seen at an angle can be pulled back into a flat rectangle.
 * Corners are top-left, top-right, bottom-right, bottom-left.
 */
function squareToQuad([p0, p1, p2, p3]: Point[]) {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    [a, b, d, e, g, h] = [x1 - x0, x3 - x0, y1 - y0, y3 - y0, 0, 0];
  } else {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
  }
  return (s: number, t: number): Point => {
    const w = g * s + h * t + 1;
    return [(a * s + b * t + x0) / w, (d * s + e * t + y0) / w];
  };
}

const dist = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Stretches each channel so its darkest 0.5% becomes black and its brightest 0.5% white. */
function stretch(data: Uint8ClampedArray, channels: number[]): void {
  const pixels = data.length / 4;
  const clip = Math.max(1, Math.floor(pixels * 0.005));
  for (const c of channels) {
    const hist = new Uint32Array(256);
    for (let i = c; i < data.length; i += 4) hist[data[i]]++;
    let lo = 0;
    for (let sum = 0; lo < 255 && (sum += hist[lo]) < clip; lo++);
    let hi = 255;
    for (let sum = 0; hi > 0 && (sum += hist[hi]) < clip; hi--);
    if (hi - lo < 16) continue;
    const scale = 255 / (hi - lo);
    for (let i = c; i < data.length; i += 4) data[i] = (data[i] - lo) * scale;
  }
}

function toGray(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = y;
  }
}

/**
 * Black and white with a local threshold (Bradley–Roth): each pixel is compared with the average
 * brightness around it, so shadows and uneven light across a photographed page do not turn black.
 */
function adaptiveThreshold(image: ImageData): void {
  const { width, height, data } = image;
  toGray(data);
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += data[((y - 1) * width + (x - 1)) * 4];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row;
    }
  }
  const half = Math.max(7, Math.round(Math.max(width, height) / 32));
  const t = 0.15;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum = integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] - integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      const i = (y * width + x) * 4;
      const v = data[i] * count < sum * (1 - t) ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
}

function applyFilter(image: ImageData, filter: ScanFilter): void {
  switch (filter) {
    case 'enhance':
      // Per-channel stretch also neutralizes the yellow or blue cast of indoor light on paper.
      stretch(image.data, [0, 1, 2]);
      break;
    case 'gray':
      toGray(image.data);
      stretch(image.data, [0, 1, 2]);
      break;
    case 'bw':
      adaptiveThreshold(image);
      break;
  }
}

/**
 * Straightens the photo to the four corners (when set) and applies the look. The result's long side
 * is at most `maxLongSide`, so previews stay fast and full renders stay within canvas limits.
 */
export function applyScan(image: ImageBitmap | AnyCanvas, scan: ScanSettings, maxLongSide: number): AnyCanvas {
  const corners = scan.corners?.map(([x, y]) => [x * image.width, y * image.height] as Point);
  let outW = image.width;
  let outH = image.height;
  if (corners) {
    outW = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
    outH = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  }
  const k = Math.min(1, maxLongSide / Math.max(outW, outH));
  const width = Math.max(1, Math.round(outW * k));
  const height = Math.max(1, Math.round(outH * k));
  const out = createCanvas(width, height);
  const ctx = getContext(out);

  if (!corners) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    // Sample from a copy only somewhat larger than the output: far faster than the full photo.
    const srcScale = Math.min(1, (Math.max(width, height) * 1.5) / Math.max(image.width, image.height));
    const sw = Math.max(1, Math.round(image.width * srcScale));
    const sh = Math.max(1, Math.round(image.height * srcScale));
    const src = createCanvas(sw, sh);
    const sctx = getContext(src);
    sctx.drawImage(image, 0, 0, sw, sh);
    const s = sctx.getImageData(0, 0, sw, sh).data;
    releaseCanvas(src);
    const map = squareToQuad(corners.map(([x, y]) => [x * srcScale, y * srcScale] as Point));
    const target = ctx.createImageData(width, height);
    const d = target.data;
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const [x, y] = map((u + 0.5) / width, (v + 0.5) / height);
        // Bilinear sampling, clamped to the photo's edges.
        const fx = Math.min(sw - 1.001, Math.max(0, x - 0.5));
        const fy = Math.min(sh - 1.001, Math.max(0, y - 0.5));
        const ix = fx | 0;
        const iy = fy | 0;
        const ax = fx - ix;
        const ay = fy - iy;
        const i00 = (iy * sw + ix) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        const o = (v * width + u) * 4;
        for (let c = 0; c < 4; c++) {
          const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
          const bottom = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
          d[o + c] = top + (bottom - top) * ay;
        }
      }
    }
    ctx.putImageData(target, 0, 0);
  }

  if (scan.filter !== 'none') {
    const pixels = ctx.getImageData(0, 0, width, height);
    applyFilter(pixels, scan.filter);
    ctx.putImageData(pixels, 0, 0);
  }
  return out;
}

/**
 * Finds a sheet of paper in a photo: the largest bright region (Otsu threshold on a small copy),
 * then its extreme corners. Returns null when no clear page stands out from the background, for
 * example when the photo is already just the page.
 */
export function detectPageCorners(image: ImageBitmap | AnyCanvas): [number, number][] | null {
  const scale = Math.min(1, 360 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const small = createCanvas(w, h);
  const ctx = getContext(small);
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  releaseCanvas(small);

  const lum = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) {
    const y = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) | 0;
    lum[i] = y;
    hist[y]++;
  }
  // Otsu: the threshold that best separates two brightness groups (paper and background).
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = lum.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  // Largest connected bright region.
  const label = new Int32Array(w * h).fill(-1);
  let bestSize = 0;
  let bestLabel = -1;
  const stack: number[] = [];
  for (let start = 0, next = 0; start < lum.length; start++) {
    if (lum[start] <= threshold || label[start] !== -1) continue;
    let size = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && label[j] === -1 && lum[j] > threshold) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
    next++;
  }
  const share = bestSize / (w * h);
  if (bestLabel < 0 || share < 0.15 || share > 0.97) return null;

  // Extreme points of the region along the diagonals are its four corners.
  let tl = [0, 0, Infinity];
  let br = [0, 0, -Infinity];
  let tr = [0, 0, -Infinity];
  let bl = [0, 0, Infinity];
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x + y < tl[2]) tl = [x, y, x + y];
    if (x + y > br[2]) br = [x, y, x + y];
    if (x - y > tr[2]) tr = [x, y, x - y];
    if (x - y < bl[2]) bl = [x, y, x - y];
  }
  const norm = ([x, y]: number[]): [number, number] => [(x + 0.5) / w, (y + 0.5) / h];
  const quad = [norm(tl), norm(tr), norm(br), norm(bl)];
  // A region that is not roughly four-sided (a sliver or a blob) is not a page.
  const [p0, p1, p2, p3] = quad;
  const area =
    Math.abs((p0[0] * p1[1] - p1[0] * p0[1]) + (p1[0] * p2[1] - p2[0] * p1[1]) + (p2[0] * p3[1] - p3[0] * p2[1]) + (p3[0] * p0[1] - p0[0] * p3[1])) / 2;
  return area > 0.12 ? quad : null;
}

export const SCAN_FILTERS: { value: ScanFilter; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'enhance', label: 'Enhanced' },
  { value: 'gray', label: 'Grayscale' },
  { value: 'bw', label: 'Black & white' },
];

export const FULL_PHOTO: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
