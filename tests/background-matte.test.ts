/**
 * Letterbox / float matte resize / guided filter / composite math for background removal.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import UPNG from 'upng-js';
import {
  MODEL_INPUT_SIZE,
  boxFilter,
  bytesToFloatAlpha,
  compositeUnpremultiplied,
  estimateForeground,
  findConstantAlphaRectangles,
  guidedFilter,
  guidedFilterRadius,
  letterboxLayout,
  lumaFloat,
  matteBounds,
  matteBoundsFloat,
  resizeMatteBicubic,
  resizeMatteBilinear,
  resizeMatteFloatBicubic,
  resizeMatteFloatBilinear,
  smoothstepAlpha,
  unletterboxMatte,
  writeCutout,
} from '../src/features/background/matte';

/** Fixtures live in the repo; resolve from cwd because the Vite test bundle moves import.meta.url. */
const FIXTURES = join(process.cwd(), 'tests/fixtures/background');

describe('background matte', () => {
  test('MODEL_INPUT_SIZE matches the inspected ONNX input side', () => {
    assert.equal(MODEL_INPUT_SIZE, 1024);
  });

  test('letterboxLayout preserves aspect and never stretches', () => {
    const wide = letterboxLayout(1600, 900, 1024);
    assert.equal(wide.contentW, 1024);
    assert.equal(wide.contentH, Math.round(900 * (1024 / 1600)));
    assert.equal(wide.padX, 0);
    assert.ok(wide.padY > 0);
    assert.equal(wide.padY * 2 + wide.contentH, 1024);

    const tall = letterboxLayout(900, 1600, 1024);
    assert.equal(tall.contentH, 1024);
    assert.equal(tall.contentW, Math.round(900 * (1024 / 1600)));
    assert.ok(tall.padX > 0);
    assert.equal(tall.padY, 0);

    const square = letterboxLayout(800, 800, 1024);
    assert.equal(square.contentW, 1024);
    assert.equal(square.contentH, 1024);
    assert.equal(square.padX, 0);
    assert.equal(square.padY, 0);
  });

  test('unletterboxMatte crops padding and round-trips with letterboxLayout', () => {
    const layout = letterboxLayout(200, 100, 64);
    const square = new Float32Array(64 * 64);
    // Put a gradient only in the content region.
    for (let y = 0; y < layout.contentH; y++) {
      for (let x = 0; x < layout.contentW; x++) {
        square[(layout.padY + y) * 64 + (layout.padX + x)] = (x + y) / (layout.contentW + layout.contentH);
      }
    }
    const cropped = unletterboxMatte(square, layout);
    assert.equal(cropped.length, layout.contentW * layout.contentH);
    assert.ok(Math.abs(cropped[0] - 0) < 1e-6);
    const last = cropped[cropped.length - 1];
    assert.ok(last > 0.4);
    // Padding cells were never copied.
    assert.equal(square[0], 0);
  });

  test('float bicubic/bilinear upscale keeps soft mid-greys (no binary threshold)', () => {
    const src = new Float32Array([0, 0.5, 0, 1]);
    const bi = resizeMatteFloatBilinear(src, 2, 2, 4, 4);
    const bc = resizeMatteFloatBicubic(src, 2, 2, 4, 4);
    assert.equal(bi.length, 16);
    assert.equal(bc.length, 16);
    // Mid values survive — not snapped to 0/1.
    const mids = [...bi, ...bc].filter((v) => v > 0.15 && v < 0.85);
    assert.ok(mids.length >= 2);
  });

  test('smoothstepAlpha 0.1–0.9 kills soft halo without binary snap', () => {
    const a = new Float32Array([0, 0.08, 0.25, 0.5, 0.75, 0.92, 1]);
    const s = smoothstepAlpha(a, 0.1, 0.9);
    assert.equal(s[0], 0);
    assert.equal(s[1], 0); // below 0.1 → halo killed
    assert.equal(s[6], 1);
    assert.ok(s[2] > 0 && s[2] < 0.4);
    assert.ok(s[3] > 0.4 && s[3] < 0.6);
    assert.ok(s[5] > 0.9); // above ~0.9 edge
  });

  test('guidedFilterRadius stays in 4–8 (~6 at 1536)', () => {
    assert.equal(guidedFilterRadius(1536), 6);
    assert.ok(guidedFilterRadius(768) >= 4);
    assert.ok(guidedFilterRadius(768) <= 6);
    assert.equal(guidedFilterRadius(4096), 8);
  });

  test('guidedFilter smooths noise while keeping a step edge on a matching guide', () => {
    const w = 32;
    const h = 32;
    const guide = new Float32Array(w * h);
    const noisy = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        guide[i] = x < 16 ? 0.1 : 0.9;
        noisy[i] = guide[i] + ((x * 17 + y * 13) % 7) / 100 - 0.03;
      }
    }
    const out = guidedFilter(guide, noisy, w, h, 4, 1e-4);
    assert.ok(out[0] < 0.3);
    assert.ok(out[16 * w - 1] > 0.7);
    // Edge band stays near the guide step (not fully blurred away).
    assert.ok(Math.abs(out[15] - out[16]) > 0.2);
  });

  test('boxFilter averages a constant field unchanged', () => {
    const src = new Float32Array(25).fill(0.4);
    const out = boxFilter(src, 5, 5, 2);
    for (const v of out) assert.ok(Math.abs(v - 0.4) < 1e-5);
  });

  test('compositeUnpremultiplied writes soft alpha and decontaminates mid-tones', () => {
    const w = 4;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const alpha = new Float32Array(w * h);
    // Left: solid red FG; right: solid green BG; middle column: 50% red-on-green fringe.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        if (x === 0) {
          rgba[o] = 200;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          alpha[i] = 1;
        } else if (x === 3) {
          rgba[o] = 0;
          rgba[o + 1] = 200;
          rgba[o + 2] = 0;
          alpha[i] = 0;
        } else {
          // Contaminated: half red + half green at 50% alpha.
          rgba[o] = 100;
          rgba[o + 1] = 100;
          rgba[o + 2] = 0;
          alpha[i] = 0.5;
        }
        rgba[o + 3] = 255;
      }
    }
    compositeUnpremultiplied(rgba, alpha, w, h, { background: 'transparent' });
    // Transparent BG pixel.
    assert.equal(rgba[3 * 4 + 3], 0);
    // Solid FG keeps red.
    assert.ok(rgba[0] > 150);
    assert.equal(rgba[3], 255);
    // Mid column: alpha soft, FG decontaminated toward red (green channel drops vs input 100).
    assert.equal(rgba[1 * 4 + 3], 128);
    assert.ok(rgba[1 * 4 + 1] < 100);
  });

  test('byte wrappers still resize without inventing size', () => {
    const src = new Uint8ClampedArray([0, 255, 0, 255]);
    const out = resizeMatteBilinear(src, 2, 2, 4, 4);
    assert.equal(out.length, 16);
    assert.ok(out[0] < out[3]);
    const bc = resizeMatteBicubic(src, 2, 2, 4, 4);
    assert.equal(bc.length, 16);
  });

  test('matteBounds helpers agree on a soft blob', () => {
    const w = 10;
    const h = 10;
    const alpha = new Uint8ClampedArray(w * h);
    for (let y = 3; y <= 6; y++) for (let x = 2; x <= 5; x++) alpha[y * w + x] = 200;
    assert.deepEqual(matteBounds(alpha, w, h), { x0: 2, y0: 3, x1: 6, y1: 7 });
    assert.deepEqual(matteBoundsFloat(bytesToFloatAlpha(alpha), w, h, 0.1), { x0: 2, y0: 3, x1: 6, y1: 7 });
  });

  test('fixture before/after set documents the soft-matte expectation', () => {
    const meta = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
      cases: { id: string; width: number; height: number; note: string }[];
    };
    assert.ok(meta.cases.length >= 2);
    for (const c of meta.cases) {
      const before = JSON.parse(readFileSync(join(FIXTURES, `${c.id}.before.json`), 'utf8')) as {
        width: number;
        height: number;
        rgba: number[];
      };
      const after = JSON.parse(readFileSync(join(FIXTURES, `${c.id}.after.json`), 'utf8')) as {
        width: number;
        height: number;
        alpha: number[];
      };
      assert.equal(before.width, c.width);
      assert.equal(before.height, c.height);
      assert.equal(after.alpha.length, c.width * c.height);
      // After matte is soft (has mid-greys), not a binary mask.
      const mids = after.alpha.filter((a) => a > 0.1 && a < 0.9);
      assert.ok(mids.length > 0, `${c.id} should keep soft alpha`);
      // Letterbox of this aspect fits without stretch.
      const layout = letterboxLayout(before.width, before.height, 64);
      assert.ok(Math.abs(layout.contentW / before.width - layout.contentH / before.height) < 1e-9);
    }
  });
});

interface Fixture {
  width: number;
  height: number;
  /** The original photo's pixels, fully opaque. */
  photo: Uint8ClampedArray;
  /** The cut-out's alpha, 0–1. */
  alpha: Float32Array;
}

/**
 * Crops of the 1536×1024 "Windblown Elegance in Burgundy" portrait: RGB is the original photo, alpha
 * is the matte the remover produced (hair at x 200–350, y 930–1000; left ear at x 340–420, y 430–490).
 * Before the fix both showed hard-edged rectangles in the cut-out.
 */
function loadFixture(name: string): Fixture {
  const bytes = readFileSync(join(FIXTURES, `${name}.png`));
  const upng = UPNG as unknown as {
    decode(buf: ArrayBuffer): { width: number; height: number };
    toRGBA8(img: { width: number; height: number }): ArrayBuffer[];
  };
  const png = upng.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const rgba = new Uint8ClampedArray(upng.toRGBA8(png)[0]);
  const n = png.width * png.height;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    alpha[i] = rgba[i * 4 + 3] / 255;
    rgba[i * 4 + 3] = 255;
  }
  return { width: png.width, height: png.height, photo: rgba, alpha };
}

const BURGUNDY = ['burgundy-hair', 'burgundy-ear'];

describe('background cut-out has no rectangular artifacts (burgundy portrait)', () => {
  test('rectangle detector finds a constant-alpha block injected into a real matte, and nothing else', () => {
    const { width, height, alpha } = loadFixture('burgundy-hair');
    assert.deepEqual(findConstantAlphaRectangles(alpha, width, height), []);
    const tampered = new Float32Array(alpha);
    for (let y = 25; y < 40; y++) for (let x = 30; x < 120; x++) tampered[y * width + x] = 0.4;
    const found = findConstantAlphaRectangles(tampered, width, height);
    assert.equal(found.length, 1);
    // Found where it was put; real matte pixels within 1/255 of 0.4 may join it at its rim.
    const r = found[0];
    assert.ok(r.x <= 30 && r.y <= 25 && r.x + r.width >= 120 && r.y + r.height >= 40, JSON.stringify(r));
    assert.ok(r.width <= 94 && r.height <= 19, JSON.stringify(r));
  });

  for (const name of BURGUNDY) {
    test(`${name}: no matte stage creates constant-alpha rectangles`, () => {
      const { width, height, photo, alpha } = loadFixture(name);
      // Re-run the matte stages on this image: model-resolution matte → bicubic upscale → smoothstep → guided filter.
      const layout = letterboxLayout(width, height, Math.round(Math.max(width, height) / 1.5));
      const small = resizeMatteFloatBicubic(alpha, width, height, layout.contentW, layout.contentH);
      const upscaled = resizeMatteFloatBicubic(small, layout.contentW, layout.contentH, width, height);
      const contrasted = smoothstepAlpha(upscaled, 0.1, 0.9);
      const refined = guidedFilter(lumaFloat(photo, width, height), contrasted, width, height, guidedFilterRadius(1536), 5e-5);
      for (const [stage, a] of [
        ['matte', alpha],
        ['upscale', upscaled],
        ['smoothstep', contrasted],
        ['guided filter', refined],
      ] as const) {
        assert.deepEqual(findConstantAlphaRectangles(a, width, height), [], `${name} ${stage}`);
      }
      // Written alpha is the matte, byte for byte — the colour step never touches it.
      const out = new Uint8ClampedArray(photo);
      compositeUnpremultiplied(out, alpha, width, height, { background: 'transparent' });
      const written = new Float32Array(width * height);
      for (let i = 0; i < written.length; i++) written[i] = out[i * 4 + 3] / 255;
      assert.deepEqual(findConstantAlphaRectangles(written, width, height), [], `${name} written alpha`);
    });

    test(`${name}: edge colour never assumes a black background (the rectangle bug)`, () => {
      const { width, height, photo, alpha } = loadFixture(name);
      const out = new Uint8ClampedArray(photo);
      compositeUnpremultiplied(out, alpha, width, height, { background: 'transparent' });
      // The old box-window estimate fell to black where no background pixel was in reach, giving
      // F = C / α: near-white patches with straight edges (28 % of hair, 39 % of ear edge pixels).
      let soft = 0;
      let blackBackground = 0;
      for (let i = 0; i < alpha.length; i++) {
        const a = alpha[i];
        if (a <= 0.05 || a >= 0.95) continue;
        soft++;
        let same = true;
        for (let c = 0; c < 3; c++) if (Math.abs(out[i * 4 + c] - Math.min(255, photo[i * 4 + c] / a)) > 3) same = false;
        if (same) blackBackground++;
      }
      assert.ok(soft > 1000, `${name} should have plenty of soft edge pixels`);
      assert.ok(blackBackground / soft < 0.01, `${name}: ${blackBackground} of ${soft} soft pixels used C / α`);
    });

    test(`${name}: on black, background is removed from thin strands`, () => {
      const { width, height, photo, alpha } = loadFixture(name);
      const out = new Uint8ClampedArray(photo);
      writeCutout(out, alpha, estimateForeground(photo, alpha, width, height), width, height, '#000000');
      // C = α·F + (1 − α)·B with B ≥ 0, so α·F (the composite on black) cannot exceed C; the
      // smooth solve may overshoot by a few levels.
      let ratio = 0;
      let count = 0;
      for (let i = 0; i < alpha.length; i++) {
        for (let c = 0; c < 3; c++) assert.ok(out[i * 4 + c] <= photo[i * 4 + c] + 5, `${name} px ${i}`);
        if (alpha[i] <= 0.05 || alpha[i] >= 0.5) continue;
        const o = i * 4;
        ratio += (out[o] + out[o + 1] + out[o + 2]) / Math.max(1, photo[o] + photo[o + 1] + photo[o + 2]);
        count++;
      }
      // The light studio background must be gone from thin strands: on black they keep well under
      // half the photo's brightness (the old estimate left 0.59 on the ear).
      assert.ok(ratio / count < 0.4, `${name}: on-black / photo = ${(ratio / count).toFixed(3)}`);
    });
  }

  test('foreground estimation recovers known colours inside a band with no pure background nearby', () => {
    // 120 px of 0.2–0.55 alpha: wider than any fixed window, so only a whole-image solve reaches background.
    const w = 160;
    const h = 60;
    const fg = [120, 70, 40];
    const alpha = new Float32Array(w * h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = x < 20 ? 1 : x >= 140 ? 0 : 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.3));
        const bg = [205 - x * 0.2, 195 - y * 0.3, 175];
        alpha[i] = a;
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(a * fg[c] + (1 - a) * bg[c]);
        rgba[i * 4 + 3] = 255;
      }
    }
    const foreground = estimateForeground(rgba, alpha, w, h);

    const onBlack = new Uint8ClampedArray(rgba);
    writeCutout(onBlack, alpha, foreground, w, h, '#000000');
    const transparent = new Uint8ClampedArray(rgba);
    writeCutout(transparent, alpha, foreground, w, h, 'transparent');
    let worst = 0;
    for (let i = 0; i < w * h; i++) {
      const a = alpha[i];
      if (a <= 0 || a >= 1) continue;
      for (let c = 0; c < 3; c++) {
        // On black: exactly α·F.
        worst = Math.max(worst, Math.abs(onBlack[i * 4 + c] - a * fg[c]));
        // Transparent: unpremultiplied, so RGB is F itself (not α·F) and alpha is the matte.
        assert.ok(Math.abs(transparent[i * 4 + c] - fg[c]) <= 6, `unpremultiplied F at ${i}`);
      }
      assert.equal(transparent[i * 4 + 3], Math.round(a * 255));
    }
    assert.ok(worst <= 3, `on-black error ${worst}`);
  });

  test('guided filter and box filter handle image borders without blocks or drift', () => {
    const w = 37;
    const h = 23;
    const guide = new Float32Array(w * h);
    for (let i = 0; i < guide.length; i++) guide[i] = ((i * 7919) % 101) / 100;
    // A constant matte must come back constant everywhere, corners included.
    const flat = guidedFilter(guide, new Float32Array(w * h).fill(0.35), w, h, 6, 5e-5);
    for (const v of flat) assert.ok(Math.abs(v - 0.35) < 1e-4);
    // Box filter at a corner averages only the pixels inside the image (no zero padding).
    const ramp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp[y * w + x] = x;
    const box = boxFilter(ramp, w, h, 3);
    assert.ok(Math.abs(box[0] - 1.5) < 1e-5);
    assert.ok(Math.abs(box[w - 1] - (w - 1 - 1.5)) < 1e-5);
  });
});

describe('background post-processing buffer reuse', () => {
  test('boxFilter in place and with a shared table matches a fresh call', () => {
    const w = 29;
    const h = 17;
    const src = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) src[i] = ((i * 2654435761) % 1000) / 1000;
    const fresh = boxFilter(src, w, h, 4);
    const table = new Float64Array((w + 1) * (h + 1));
    boxFilter(src, w, h, 2, new Float32Array(w * h), table); // dirty the shared table first
    const shared = boxFilter(src, w, h, 4, new Float32Array(w * h), table);
    const inPlace = new Float32Array(src);
    boxFilter(inPlace, w, h, 4, inPlace, table);
    for (let i = 0; i < src.length; i++) {
      assert.ok(Math.abs(shared[i] - fresh[i]) < 1e-6);
      assert.ok(Math.abs(inPlace[i] - fresh[i]) < 1e-6);
    }
  });

  test('guidedFilter matches a straightforward reference implementation', () => {
    const w = 41;
    const h = 27;
    const r = 5;
    const eps = 5e-5;
    const guide = new Float32Array(w * h);
    const p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        guide[i] = (x < 20 ? 0.2 : 0.7) + ((i * 7919) % 13) / 200;
        p[i] = x < 18 ? 0.05 : x > 23 ? 0.95 : 0.5;
      }
    }
    const box = (a: Float32Array) => boxFilter(a, w, h, r);
    const prod = (a: Float32Array, b: Float32Array) => a.map((v, i) => v * b[i]);
    const mI = box(guide);
    const mP = box(p);
    const cI = box(prod(guide, guide));
    const cIP = box(prod(guide, p));
    const A = mI.map((m, i) => (cIP[i] - m * mP[i]) / (cI[i] - m * m + eps));
    const B = mP.map((m, i) => m - A[i] * mI[i]);
    const mA = box(A);
    const mB = box(B);
    const expected = guide.map((g, i) => Math.min(1, Math.max(0, mA[i] * g + mB[i])));
    const actual = guidedFilter(guide, p, w, h, r, eps);
    for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-4, `px ${i}`);
  });
});

