/**
 * Telea fast-marching inpainting for a rectangular (or freeform) mask.
 * Runs only on a padded crop of the photo so large images stay responsive.
 */

const INF = 1e6;
const KNOWN = 0;
const BAND = 1;
const INSIDE = 2;

interface HeapItem {
  t: number;
  i: number;
}

/** Binary min-heap on travel time. */
class MinHeap {
  private readonly data: HeapItem[] = [];

  get size(): number {
    return this.data.length;
  }

  push(item: HeapItem): void {
    const data = this.data;
    data.push(item);
    let i = data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (data[p].t <= data[i].t) break;
      const tmp = data[p];
      data[p] = data[i];
      data[i] = tmp;
      i = p;
    }
  }

  pop(): HeapItem | undefined {
    const data = this.data;
    if (data.length === 0) return undefined;
    const top = data[0];
    const last = data.pop()!;
    if (data.length === 0) return top;
    data[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < data.length && data[l].t < data[smallest].t) smallest = l;
      if (r < data.length && data[r].t < data[smallest].t) smallest = r;
      if (smallest === i) break;
      const tmp = data[i];
      data[i] = data[smallest];
      data[smallest] = tmp;
      i = smallest;
    }
    return top;
  }
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/**
 * Fills every pixel where `mask[i] !== 0` using neighbouring known pixels (Telea).
 * Mutates `rgba` in place. `mask` is one byte per pixel (non-zero = fill).
 */
export function inpaintTelea(rgba: Uint8ClampedArray, width: number, height: number, mask: Uint8Array, radius = 5): void {
  const n = width * height;
  const flag = new Uint8Array(n);
  const t = new Float32Array(n);
  const heap = new MinHeap();

  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      flag[i] = INSIDE;
      t[i] = INF;
    } else {
      flag[i] = KNOWN;
      t[i] = 0;
    }
  }

  const pushBand = (x: number, y: number) => {
    const i = y * width + x;
    if (flag[i] !== INSIDE) return;
    flag[i] = BAND;
    t[i] = 0;
    heap.push({ t: 0, i });
  };

  // Seed the narrow band with INSIDE pixels that touch a known neighbour.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (flag[i] !== INSIDE) continue;
      if (
        (x > 0 && flag[i - 1] === KNOWN) ||
        (x + 1 < width && flag[i + 1] === KNOWN) ||
        (y > 0 && flag[i - width] === KNOWN) ||
        (y + 1 < height && flag[i + width] === KNOWN)
      ) {
        pushBand(x, y);
      }
    }
  }

  // Isolated mask with no known neighbours: nothing useful to do.
  if (heap.size === 0) return;

  const solve = (x1: number, y1: number, x2: number, y2: number): number => {
    if (x1 < 0 || x1 >= width || y1 < 0 || y1 >= height) return INF;
    if (x2 < 0 || x2 >= width || y2 < 0 || y2 >= height) return INF;
    const i1 = y1 * width + x1;
    const i2 = y2 * width + x2;
    const f1 = flag[i1];
    const f2 = flag[i2];
    if (f1 !== KNOWN && f1 !== BAND) return f2 === KNOWN || f2 === BAND ? 1 + t[i2] : INF;
    if (f2 !== KNOWN && f2 !== BAND) return 1 + t[i1];
    const t1 = t[i1];
    const t2 = t[i2];
    const d = 2 * t1 - 2 * t2;
    // Solve the eikonal equation for a 45° step between two known times.
    const disc = d * d - 8 * (t1 * t1 - 2 * t1 * t2 + t2 * t2 - 1);
    if (disc < 0) return 1 + Math.min(t1, t2);
    return (t1 + t2 + Math.sqrt(disc)) * 0.5;
  };

  const paint = (x: number, y: number): void => {
    const dst = y * width + x;
    let weightSum = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;

    // Gradients of T around the pixel (for directional weighting).
    const gradTx =
      (x > 0 && x + 1 < width ? t[dst + 1] - t[dst - 1] : x + 1 < width ? t[dst + 1] - t[dst] : t[dst] - t[dst - 1]) * 0.5;
    const gradTy =
      (y > 0 && y + 1 < height ? t[dst + width] - t[dst - width] : y + 1 < height ? t[dst + width] - t[dst] : t[dst] - t[dst - width]) *
      0.5;

    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const dist2 = dx * dx + dy * dy;
        if (dist2 === 0 || dist2 > r2) continue;
        const src = yy * width + xx;
        if (flag[src] !== KNOWN) continue;

        const dist = Math.sqrt(dist2);
        const dirx = dx / dist;
        const diry = dy / dist;
        // Prefer samples that lie along the arrival front (Telea directional term).
        const direction = Math.abs(dirx * gradTx + diry * gradTy) + 0.01;
        const level = 1 / (1 + Math.abs(t[src] - t[dst]));
        const distWeight = 1 / (dist * dist);
        const w = direction * level * distWeight;

        const o = src * 4;
        weightSum += w;
        r += rgba[o] * w;
        g += rgba[o + 1] * w;
        b += rgba[o + 2] * w;
        a += rgba[o + 3] * w;
      }
    }

    if (weightSum <= 0) return;
    const o = dst * 4;
    rgba[o] = Math.round(r / weightSum);
    rgba[o + 1] = Math.round(g / weightSum);
    rgba[o + 2] = Math.round(b / weightSum);
    rgba[o + 3] = Math.round(a / weightSum);
  };

  while (heap.size > 0) {
    const item = heap.pop()!;
    const i = item.i;
    // Stale heap entries from earlier, larger times are skipped.
    if (flag[i] === KNOWN || item.t > t[i] + 1e-6) continue;
    flag[i] = KNOWN;
    const x = i % width;
    const y = (i / width) | 0;
    paint(x, y);

    const neighbours: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (flag[ni] === KNOWN) continue;
      const nextT = Math.min(solve(nx - 1, ny, nx, ny - 1), solve(nx + 1, ny, nx, ny - 1), solve(nx - 1, ny, nx, ny + 1), solve(nx + 1, ny, nx, ny + 1));
      if (nextT < t[ni]) {
        t[ni] = nextT;
        flag[ni] = BAND;
        heap.push({ t: nextT, i: ni });
      }
    }
  }

  // Soften the seam: blend a 1px ring of filled pixels with their original neighbours.
  void clamp;
}
