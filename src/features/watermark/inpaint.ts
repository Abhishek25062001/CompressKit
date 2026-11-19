/**
 * Exemplar-based inpainting for watermark holes.
 * Copies real patches from the surroundings (better for fabric, wood and borders than Telea blur).
 */

const KNOWN = 0;
const FILL = 1;

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Squared colour distance of two RGBA pixels (alpha ignored for matching). */
function colourDist2(a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number): number {
  const dr = a[ai] - b[bi];
  const dg = a[ai + 1] - b[bi + 1];
  const db = a[ai + 2] - b[bi + 2];
  return dr * dr + dg * dg + db * db;
}

/** Local edge strength used as Criminisi-style priority so lines continue across the hole. */
function edgeStrength(rgba: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  const xm = Math.max(0, x - 1);
  const xp = Math.min(width - 1, x + 1);
  const ym = Math.max(0, y - 1);
  const yp = Math.min(height - 1, y + 1);
  const o = (yy: number, xx: number) => (yy * width + xx) * 4;
  const lx = Math.abs(rgba[o(y, xp)] - rgba[o(y, xm)]) + Math.abs(rgba[o(y, xp) + 1] - rgba[o(y, xm) + 1]) + Math.abs(rgba[o(y, xp) + 2] - rgba[o(y, xm) + 2]);
  const ly = Math.abs(rgba[o(yp, x)] - rgba[o(ym, x)]) + Math.abs(rgba[o(yp, x) + 1] - rgba[o(ym, x) + 1]) + Math.abs(rgba[o(yp, x) + 2] - rgba[o(ym, x) + 2]);
  return lx + ly;
}

/**
 * Patch SSD over known pixels only. Returns Infinity when the candidate has no known overlap.
 */
function patchError(
  rgba: Uint8ClampedArray,
  flag: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  pr: number,
): number {
  let err = 0;
  let count = 0;
  for (let dy = -pr; dy <= pr; dy++) {
    for (let dx = -pr; dx <= pr; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      const qx = sx + dx;
      const qy = sy + dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      if (qx < 0 || qy < 0 || qx >= width || qy >= height) return Infinity;
      const ti = ty * width + tx;
      const qi = qy * width + qx;
      // Target known pixels must match; candidate must be known.
      if (flag[qi] !== KNOWN) return Infinity;
      if (flag[ti] !== KNOWN) continue;
      err += colourDist2(rgba, ti * 4, rgba, qi * 4);
      count++;
    }
  }
  return count === 0 ? Infinity : err / count;
}

/**
 * Fills every pixel where `mask[i] !== 0` by copying the best nearby patch.
 * Mutates `rgba` in place. Much sharper on textures and borders than Telea.
 */
export function inpaintExemplar(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  options?: { patchRadius?: number; searchRadius?: number },
): void {
  const n = width * height;
  const flag = new Uint8Array(n);
  const confidence = new Float32Array(n);
  let remaining = 0;

  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      flag[i] = FILL;
      confidence[i] = 0;
      remaining++;
    } else {
      flag[i] = KNOWN;
      confidence[i] = 1;
    }
  }
  if (remaining === 0) return;

  const patchRadius = options?.patchRadius ?? 4;
  const searchRadius = options?.searchRadius ?? Math.min(72, Math.max(28, Math.round(Math.sqrt(remaining))));

  // Random search offsets (PatchMatch-style) so we do not scan the whole window every time.
  const probes: [number, number][] = [[0, 0]];
  for (let i = 0; i < 48; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * searchRadius;
    probes.push([Math.round(Math.cos(ang) * rad), Math.round(Math.sin(ang) * rad)]);
  }
  // Dense local ring: nearby pixels are usually the best match for fabric and borders.
  for (let dy = -searchRadius; dy <= searchRadius; dy += 2) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 2) {
      if (dx * dx + dy * dy > searchRadius * searchRadius) continue;
      if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) probes.push([dx, dy]);
    }
  }

  const inFrontier = new Uint8Array(n);
  const frontier: number[] = [];

  const addFrontier = (i: number) => {
    if (flag[i] !== FILL || inFrontier[i]) return;
    const x = i % width;
    const y = (i / width) | 0;
    const edge =
      (x > 0 && flag[i - 1] === KNOWN) ||
      (x + 1 < width && flag[i + 1] === KNOWN) ||
      (y > 0 && flag[i - width] === KNOWN) ||
      (y + 1 < height && flag[i + width] === KNOWN);
    if (!edge) return;
    inFrontier[i] = 1;
    frontier.push(i);
  };

  for (let i = 0; i < n; i++) addFrontier(i);
  if (frontier.length === 0) return;

  // Process the hole from the rim inward, highest structure priority first.
  while (remaining > 0 && frontier.length > 0) {
    let bestPos = 0;
    let bestScore = -1;
    for (let f = 0; f < frontier.length; f++) {
      const i = frontier[f];
      if (flag[i] !== FILL) continue;
      const x = i % width;
      const y = (i / width) | 0;
      let conf = 0;
      let neighbours = 0;
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
        if (flag[ni] !== KNOWN) continue;
        conf += confidence[ni];
        neighbours++;
      }
      if (neighbours === 0) continue;
      const score = (conf / neighbours) * (1 + edgeStrength(rgba, width, height, x, y));
      if (score > bestScore) {
        bestScore = score;
        bestPos = f;
      }
    }

    if (bestScore < 0) {
      // Frontier list went stale; rebuild from the remaining hole.
      frontier.length = 0;
      inFrontier.fill(0);
      for (let i = 0; i < n; i++) addFrontier(i);
      if (frontier.length === 0) break;
      continue;
    }

    const target = frontier[bestPos];
    // Swap-remove from frontier.
    frontier[bestPos] = frontier[frontier.length - 1];
    frontier.pop();
    inFrontier[target] = 0;
    if (flag[target] !== FILL) continue;

    const cx = target % width;
    const cy = (target / width) | 0;

    let bestErr = Infinity;
    let bestX = cx;
    let bestY = cy;
    for (const [ox, oy] of probes) {
      const sx = cx + ox;
      const sy = cy + oy;
      if (sx < patchRadius || sy < patchRadius || sx >= width - patchRadius || sy >= height - patchRadius) continue;
      if (flag[sy * width + sx] !== KNOWN) continue;
      const err = patchError(rgba, flag, width, height, cx, cy, sx, sy, patchRadius);
      if (err < bestErr) {
        bestErr = err;
        bestX = sx;
        bestY = sy;
      }
    }

    const filled: number[] = [];
    const copyR = bestErr < Infinity ? 1 : 0;
    for (let dy = -copyR; dy <= copyR; dy++) {
      for (let dx = -copyR; dx <= copyR; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const ti = ty * width + tx;
        if (flag[ti] !== FILL) continue;
        const sx = bestX + dx;
        const sy = bestY + dy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height || flag[sy * width + sx] !== KNOWN) {
          if (dx !== 0 || dy !== 0) continue;
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let c = 0;
          for (const [nx, ny] of [
            [tx - 1, ty],
            [tx + 1, ty],
            [tx, ty - 1],
            [tx, ty + 1],
          ] as const) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (flag[ni] !== KNOWN) continue;
            const o = ni * 4;
            r += rgba[o];
            g += rgba[o + 1];
            b += rgba[o + 2];
            a += rgba[o + 3];
            c++;
          }
          if (c === 0) continue;
          const o = ti * 4;
          rgba[o] = Math.round(r / c);
          rgba[o + 1] = Math.round(g / c);
          rgba[o + 2] = Math.round(b / c);
          rgba[o + 3] = Math.round(a / c);
        } else {
          const so = (sy * width + sx) * 4;
          const o = ti * 4;
          rgba[o] = rgba[so];
          rgba[o + 1] = rgba[so + 1];
          rgba[o + 2] = rgba[so + 2];
          rgba[o + 3] = rgba[so + 3];
        }
        flag[ti] = KNOWN;
        confidence[ti] = clamp(bestScore / (1 + edgeStrength(rgba, width, height, cx, cy)), 0.05, 1);
        remaining--;
        filled.push(ti);
        if (inFrontier[ti]) inFrontier[ti] = 0;
      }
    }

    // Only neighbours of newly filled pixels can join the frontier.
    for (const ti of filled) {
      const x = ti % width;
      const y = (ti / width) | 0;
      if (x > 0) addFrontier(ti - 1);
      if (x + 1 < width) addFrontier(ti + 1);
      if (y > 0) addFrontier(ti - width);
      if (y + 1 < height) addFrontier(ti + width);
    }
    // Compact stale frontier entries occasionally.
    if (frontier.length > remaining * 2 + 64) {
      let w = 0;
      for (let r = 0; r < frontier.length; r++) {
        const i = frontier[r];
        if (flag[i] === FILL && inFrontier[i]) frontier[w++] = i;
        else inFrontier[i] = 0;
      }
      frontier.length = w;
    }
  }
}

/**
 * Distance (in pixels) from each masked pixel to the nearest known pixel.
 * Used to feather the seam when pasting the fill back.
 */
export function maskDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const n = width * height;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let i = 0; i < n; i++) dist[i] = mask[i] ? INF : 0;

  // Two-pass chamfer distance approximate.
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
