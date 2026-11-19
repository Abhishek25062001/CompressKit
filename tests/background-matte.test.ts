/**
 * Letterbox / float matte resize / guided filter / composite math for background removal.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_INPUT_SIZE,
  boxFilter,
  bytesToFloatAlpha,
  compositeUnpremultiplied,
  guidedFilter,
  guidedFilterRadius,
  letterboxLayout,
  matteBounds,
  matteBoundsFloat,
  resizeMatteBicubic,
  resizeMatteBilinear,
  resizeMatteFloatBicubic,
  resizeMatteFloatBilinear,
  smoothstepAlpha,
  unletterboxMatte,
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

  test('smoothstepAlpha is gentle and not a hard threshold', () => {
    const a = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
    const s = smoothstepAlpha(a, 0.05, 0.95);
    assert.equal(s[0], 0);
    assert.equal(s[4], 1);
    assert.ok(s[1] > 0 && s[1] < 0.5);
    assert.ok(s[2] > 0.4 && s[2] < 0.6);
  });

  test('guidedFilterRadius scales with width (~12 at 1536)', () => {
    assert.equal(guidedFilterRadius(1536), 12);
    assert.ok(guidedFilterRadius(768) < 12);
    assert.ok(guidedFilterRadius(3072) > 12);
    assert.ok(guidedFilterRadius(3072) <= 24);
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
    compositeUnpremultiplied(rgba, alpha, w, h, { background: 'transparent', blurRadius: 2 });
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
