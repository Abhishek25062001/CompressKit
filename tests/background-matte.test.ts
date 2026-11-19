/**
 * Matte resize / edge refine / composite math for background removal.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MODEL_INPUT_SIZE,
  applyMatteToRgba,
  matteBounds,
  refineMatteEdges,
  resizeMatteBicubic,
  resizeMatteBilinear,
} from '../src/features/background/matte';

describe('background matte', () => {
  test('MODEL_INPUT_SIZE matches the inspected ONNX input side', () => {
    assert.equal(MODEL_INPUT_SIZE, 1024);
  });

  test('resizeMatteBilinear upscales a sharp step without inventing size', () => {
    const src = new Uint8ClampedArray(4);
    src[0] = 0;
    src[1] = 255;
    src[2] = 0;
    src[3] = 255;
    const out = resizeMatteBilinear(src, 2, 2, 4, 4);
    assert.equal(out.length, 16);
    // Left half stays darker than right half on the top row.
    assert.ok(out[0] < out[3]);
    assert.ok(out[1] <= out[2] || out[2] >= 100);
  });

  test('resizeMatteBicubic preserves corners of a solid block when upsizing', () => {
    const sw = 4;
    const sh = 4;
    const src = new Uint8ClampedArray(sw * sh);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) src[y * sw + x] = 255;
    const out = resizeMatteBicubic(src, sw, sh, 8, 8);
    assert.equal(out.length, 64);
    // Centre of the upscaled block stays high; far corner stays near zero.
    assert.ok(out[4 * 8 + 4] > 200);
    assert.ok(out[0] < 40);
  });

  test('refineMatteEdges pushes mid greys apart and softens by ~1 px', () => {
    const w = 8;
    const h = 8;
    const alpha = new Uint8ClampedArray(w * h);
    // Soft blob in the centre.
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) alpha[y * w + x] = 180;
    alpha[3 * w + 3] = 128;
    const refined = refineMatteEdges(alpha, w, h);
    // Contrast curve moves the mid grey away from 128.
    assert.notEqual(refined[3 * w + 3], 128);
    // Outside the blob stays low.
    assert.ok(refined[0] < 30);
  });

  test('applyMatteToRgba writes alpha for transparent output', () => {
    const w = 2;
    const h = 2;
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    const matte = new Uint8ClampedArray([0, 128, 255, 64]);
    applyMatteToRgba(rgba, matte, w, h, { background: 'transparent' });
    assert.equal(rgba[3], 0);
    assert.equal(rgba[7], 128);
    assert.equal(rgba[11], 255);
    assert.equal(rgba[15], 64);
    // RGB unchanged when keeping transparency.
    assert.equal(rgba[0], 10);
  });

  test('applyMatteToRgba flattens onto a solid colour for JPEG', () => {
    const w = 1;
    const h = 1;
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const matte = new Uint8ClampedArray([128]); // ≈50% subject
    applyMatteToRgba(rgba, matte, w, h, { background: '#ffffff' });
    // 0·(128/255) + 255·(127/255) → 127
    assert.equal(rgba[0], 127);
    assert.equal(rgba[1], 127);
    assert.equal(rgba[2], 127);
    assert.equal(rgba[3], 255);
  });

  test('matteBounds finds the subject box', () => {
    const w = 10;
    const h = 10;
    const alpha = new Uint8ClampedArray(w * h);
    for (let y = 3; y <= 6; y++) for (let x = 2; x <= 5; x++) alpha[y * w + x] = 200;
    const box = matteBounds(alpha, w, h)!;
    assert.deepEqual(box, { x0: 2, y0: 3, x1: 6, y1: 7 });
    assert.equal(matteBounds(new Uint8ClampedArray(w * h), w, h), null);
  });
});
