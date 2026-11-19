/**
 * Crop / dilate / context / feather math for LaMa watermark removal.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  COMPOSITE_FEATHER,
  CONTEXT_MIN,
  CONTEXT_SCALE,
  LAMA_SIZE,
  MASK_DILATE,
  contextWindow,
  dilateMask,
  featherAlpha,
  fractionToPixels,
  maskBounds,
  maskDistance,
  reflectIndex,
  squarePad,
} from '../src/features/watermark/geometry';

describe('watermark geometry', () => {
  test('fractionToPixels expands and clamps to the image', () => {
    const r = fractionToPixels({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 }, 100, 100, 2);
    assert.equal(r.x0, 48);
    assert.equal(r.y0, 48);
    assert.equal(r.x1, 77);
    assert.equal(r.y1, 77);

    const edge = fractionToPixels({ x: 0, y: 0, width: 0.1, height: 0.1 }, 100, 100, 5);
    assert.equal(edge.x0, 0);
    assert.equal(edge.y0, 0);
  });

  test('dilateMask grows a single pixel by MASK_DILATE', () => {
    const w = 21;
    const h = 21;
    const mask = new Uint8Array(w * h);
    mask[10 * w + 10] = 1;
    const out = dilateMask(mask, w, h, MASK_DILATE);
    const bounds = maskBounds(out, w, h)!;
    assert.equal(bounds.x0, 10 - MASK_DILATE);
    assert.equal(bounds.y0, 10 - MASK_DILATE);
    assert.equal(bounds.x1, 10 + MASK_DILATE + 1);
    assert.equal(bounds.y1, 10 + MASK_DILATE + 1);
    assert.equal(out[10 * w + 10], 1);
    assert.equal(out[0], 0);
  });

  test('contextWindow is ~3× the mask side, at least 256, and stays in-bounds', () => {
    const bounds = { x0: 400, y0: 400, x1: 440, y1: 420 }; // 40×20
    const win = contextWindow(bounds, 1000, 1000);
    const side = Math.max(win.x1 - win.x0, win.y1 - win.y0);
    assert.ok(side >= CONTEXT_MIN);
    assert.ok(side >= Math.ceil(40 * CONTEXT_SCALE) - 1);
    assert.ok(win.x0 >= 0 && win.y0 >= 0);
    assert.ok(win.x1 <= 1000 && win.y1 <= 1000);
    // Mask stays inside the window.
    assert.ok(win.x0 <= bounds.x0 && win.x1 >= bounds.x1);
    assert.ok(win.y0 <= bounds.y0 && win.y1 >= bounds.y1);

    const corner = contextWindow({ x0: 0, y0: 0, x1: 10, y1: 10 }, 100, 100);
    assert.equal(corner.x0, 0);
    assert.equal(corner.y0, 0);
    assert.equal(corner.x1, 100);
    assert.equal(corner.y1, 100);
  });

  test('reflectIndex mirrors at the edges', () => {
    assert.equal(reflectIndex(0, 5), 0);
    assert.equal(reflectIndex(4, 5), 4);
    assert.equal(reflectIndex(-1, 5), 1);
    assert.equal(reflectIndex(5, 5), 3);
    assert.equal(reflectIndex(1, 1), 0);
  });

  test('squarePad centres a non-square crop', () => {
    const a = squarePad(100, 60);
    assert.equal(a.side, 100);
    assert.equal(a.padX, 0);
    assert.equal(a.padY, 20);
    const b = squarePad(40, 80);
    assert.equal(b.side, 80);
    assert.equal(b.padX, 20);
    assert.equal(b.padY, 0);
  });

  test('featherAlpha ramps over COMPOSITE_FEATHER pixels', () => {
    assert.equal(featherAlpha(0), 0);
    assert.equal(featherAlpha(COMPOSITE_FEATHER), 1);
    assert.equal(featherAlpha(COMPOSITE_FEATHER + 5), 1);
    assert.ok(featherAlpha(1) > 0 && featherAlpha(1) < 1);
  });

  test('maskDistance is 0 outside the mask and grows toward the centre', () => {
    const w = 7;
    const h = 7;
    const mask = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) mask[y * w + x] = 1;
    const dist = maskDistance(mask, w, h);
    assert.equal(dist[0], 0);
    assert.ok(dist[3 * w + 3] >= dist[2 * w + 2]);
    assert.ok(dist[2 * w + 2] > 0);
  });

  test('LAMA_SIZE stays 512 for the fixed ONNX graphs', () => {
    assert.equal(LAMA_SIZE, 512);
  });
});
