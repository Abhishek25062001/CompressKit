/**
 * The rules that decide what a file becomes: which tool a search finds, which tool takes a file,
 * and what size a resized photo comes out at. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_IMAGE_SETTINGS } from '../src/constants/presets';
import { MAX_CUSTOM_SIDE, RESIZE_PRESETS } from '../src/constants/resizePresets';
import { CATALOG, SITE_URL, pageUrl, robotsTxt, sitemapXml, type ToolId } from '../src/features/catalog';
import { FEATURES, searchFeatures } from '../src/features/directory';
import { ANY_TOOL_ACCEPT, acceptsFile, matchTools } from '../src/features/handoff';
import { computeTargetSize } from '../src/features/image/resize';
import { centeredCrop, cropFits, outputSize } from '../src/features/resize/resizeJob';
import type { ItemCrop, ResizeSettings } from '../src/types/resize';

const file = (name: string, type = '') => new File([], name, { type });
const keys = (query: string) => searchFeatures(query).map((f) => f.key);

describe('search', () => {
  test('an empty query lists every tool', () => {
    assert.equal(searchFeatures('').length, FEATURES.length);
    assert.equal(searchFeatures('   ').length, FEATURES.length);
  });

  test('a tool name comes first', () => {
    assert.equal(keys('PDF to Word')[0], 'pdf-to-word');
    assert.equal(keys('word to pdf')[0], 'word-to-pdf');
    assert.equal(keys('passport')[0], 'passport-photo');
    assert.equal(keys('heic')[0], 'heic-to-jpg');
  });

  test('case and punctuation do not matter', () => {
    assert.deepEqual(keys('  pdf—TO—word!! '), keys('PDF to Word'));
    assert.deepEqual(keys('passport & visa'), keys('passport and visa'));
  });

  test('every word must match', () => {
    const found = keys('compress video');
    assert.ok(found.includes('compress-video'));
    assert.ok(!found.includes('compress-images'));
    assert.ok(!found.includes('compress-pdf'));
  });

  test('keywords find a tool its name does not mention', () => {
    assert.ok(keys('shrink photo').includes('compress-images'));
  });

  test('nonsense finds nothing', () => {
    assert.deepEqual(keys('zzqxv'), []);
  });

  test('the switched-off background remover stays hidden', () => {
    assert.ok(!keys('remove background').includes('remove-background'));
    assert.ok(FEATURES.every((f) => !f.key.includes('background')));
  });

  test('every tool can be found by its own name', () => {
    for (const f of FEATURES) assert.ok(keys(f.name).includes(f.key), f.name);
  });
});

describe('accepted formats', () => {
  const takes = (id: ToolId, name: string, type?: string) => acceptsFile(id, file(name, type));

  test('compress takes the common photos and videos', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.avif', 'a.mp4', 'a.mov', 'a.webm', 'a.mkv']) {
      assert.ok(takes('compress', name), name);
    }
    assert.ok(!takes('compress', 'a.pdf'));
    assert.ok(!takes('compress', 'a.heic'));
  });

  test('a file without a type is recognised by its extension, in any case', () => {
    assert.ok(takes('convert', 'IMG_0001.HEIC'));
    assert.ok(takes('compress', 'CLIP.MOV'));
  });

  test('a file without an extension is recognised by its type', () => {
    assert.ok(takes('compress', 'photo', 'image/jpeg'));
    assert.ok(takes('pdf', 'scan', 'application/pdf'));
  });

  test('HEIC converts but cannot be resized', () => {
    assert.ok(takes('convert', 'a.heic', 'image/heic'));
    assert.ok(!takes('resize', 'a.heic', 'image/heic'));
    assert.ok(takes('clean', 'a.heic', 'image/heic'));
  });

  test('resize takes photos only', () => {
    assert.ok(takes('resize', 'a.jpg', 'image/jpeg'));
    assert.ok(takes('resize', 'a.bmp'));
    assert.ok(!takes('resize', 'a.mp4', 'video/mp4'));
  });

  test('clean leaves out the containers phones never tag with a location', () => {
    assert.ok(takes('clean', 'a.mov'));
    assert.ok(!takes('clean', 'a.webm'));
    assert.ok(!takes('clean', 'a.mkv'));
  });

  test('PDF tools take Word files, the PDF editor does not', () => {
    assert.ok(takes('pdf', 'a.docx'));
    assert.ok(takes('merge', 'a.docx'));
    assert.ok(!takes('edit-pdf', 'a.docx'));
    assert.ok(takes('edit-pdf', 'a.pdf'));
  });

  test('document converters take only their own input', () => {
    assert.ok(takes('docx-to-pdf', 'a.docx'));
    assert.ok(!takes('docx-to-pdf', 'a.pdf'));
    assert.ok(takes('text-to-pdf', 'notes.md'));
    assert.ok(takes('excel-to-pdf', 'a.csv'));
    assert.ok(takes('pptx-to-pdf', 'a.pptx'));
    assert.ok(!takes('pdf-to-docx', 'a.docx'));
  });

  test('a dropped file is offered to the right tools', () => {
    const forPdf = matchTools([file('a.pdf', 'application/pdf')]).map((m) => m.id);
    assert.ok(forPdf.includes('pdf') && forPdf.includes('pdf-to-docx') && forPdf.includes('edit-docx'));
    assert.ok(!forPdf.includes('compress'));

    const forHeic = matchTools([file('a.heic')]).map((m) => m.id);
    assert.ok(forHeic.includes('convert') && forHeic.includes('clean'));
    assert.ok(!forHeic.includes('resize'));

    assert.deepEqual(matchTools([file('a.exe')]), []);
  });

  test('a mixed drop gives each tool only the files it takes', () => {
    const match = matchTools([file('a.jpg'), file('b.pdf')]).find((m) => m.id === 'compress');
    assert.deepEqual(match?.files.map((f) => f.name), ['a.jpg']);
  });

  test('every tool takes something, and the home picker offers it', () => {
    for (const tool of CATALOG) {
      assert.ok(matchTools([file('a.jpg'), file('a.mp4'), file('a.pdf'), file('a.docx'), file('a.txt'), file('a.rtf'), file('a.html'), file('a.xlsx'), file('a.pptx')]).some((m) => m.id === tool.id), tool.id);
    }
    for (const ext of ['.jpg', '.heic', '.mp4', '.pdf', '.docx', '.xlsx', '.pptx', '.md', '.rtf', '.html', '.csv']) {
      assert.ok(ANY_TOOL_ACCEPT.split(',').includes(ext), ext);
    }
  });
});

describe('resize limits', () => {
  const settings = (s: Partial<ResizeSettings>): ResizeSettings => ({
    preset: 'custom',
    customWidth: 800,
    customHeight: 600,
    format: 'jpeg',
    targetKB: null,
    ...s,
  });

  test('presets keep their exact size', () => {
    assert.deepEqual(outputSize(settings({ preset: 'passport' })), { width: 413, height: 531 });
    assert.deepEqual(outputSize(settings({ preset: 'story' })), { width: 1080, height: 1920 });
  });

  test('freehand has no fixed size', () => {
    assert.equal(outputSize(settings({ preset: 'freehand' })), null);
  });

  test('custom sizes stay between 1 px and the maximum side', () => {
    assert.deepEqual(outputSize(settings({ customWidth: 20000, customHeight: 9000 })), { width: MAX_CUSTOM_SIDE, height: MAX_CUSTOM_SIDE });
    assert.deepEqual(outputSize(settings({ customWidth: 0, customHeight: -5 })), { width: 1, height: 1 });
    assert.deepEqual(outputSize(settings({ customWidth: Number.NaN, customHeight: 12.6 })), { width: 1, height: 13 });
  });

  test('every preset fits the maximum side', () => {
    for (const p of RESIZE_PRESETS) {
      assert.ok(p.width >= 1 && p.width <= MAX_CUSTOM_SIDE && p.height >= 1 && p.height <= MAX_CUSTOM_SIDE, p.id);
    }
  });

  test('a max box shrinks without changing the shape, and never enlarges', () => {
    const box = { ...DEFAULT_IMAGE_SETTINGS, preserveResolution: false, maxWidth: 1000, maxHeight: 1000 };
    assert.deepEqual(computeTargetSize({ width: 4000, height: 3000 }, box), { width: 1000, height: 750 });
    assert.deepEqual(computeTargetSize({ width: 3000, height: 6000 }, box), { width: 500, height: 1000 });
    assert.deepEqual(computeTargetSize({ width: 640, height: 480 }, box), { width: 640, height: 480 });
    assert.deepEqual(computeTargetSize({ width: 100000, height: 10 }, box), { width: 1000, height: 1 });
  });

  test('keeping the resolution ignores the box', () => {
    const keep = { ...DEFAULT_IMAGE_SETTINGS, preserveResolution: true, maxWidth: 100, maxHeight: 100 };
    assert.deepEqual(computeTargetSize({ width: 4000, height: 3000 }, keep), { width: 4000, height: 3000 });
  });

  test('a preset crop is the largest centered area of its shape', () => {
    assert.deepEqual(centeredCrop(2000, 1000, 1), { x: 0.25, y: 0, width: 0.5, height: 1 });
    assert.deepEqual(centeredCrop(1000, 2000, 1), { x: 0, y: 0.25, width: 1, height: 0.5 });
  });

  test('a saved crop only applies to a preset of the same shape', () => {
    // Results go through a boolean first: asserting a type guard false would narrow the crop to never.
    const fits = (c: ItemCrop | null, aspect: number | null): boolean => cropFits(c, aspect);
    const square: ItemCrop = { rotate: 0, mirror: false, rect: { x: 0, y: 0, width: 1, height: 1 }, aspect: 1 };
    const freehand: ItemCrop = { ...square, aspect: null };
    assert.ok(fits(square, 1));
    assert.ok(fits(square, 1.004));
    assert.ok(!fits(square, 413 / 531));
    assert.ok(fits(square, null));
    assert.ok(!fits(freehand, 1));
    assert.ok(!fits(null, 1));
  });
});

describe('tool addresses', () => {
  const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  test('the sitemap lists the home page and every tool page once', () => {
    assert.deepEqual(locs, [`${SITE_URL}/`, ...CATALOG.map((t) => `${SITE_URL}${t.path}`)]);
    assert.equal(new Set(locs).size, locs.length);
  });

  test('every address is a full https URL on the site, without a trailing slash or hash', () => {
    for (const loc of locs) {
      const url = new URL(loc);
      assert.equal(url.origin, SITE_URL, loc);
      assert.equal(url.hash, '', loc);
      assert.ok(url.pathname === '/' || !url.pathname.endsWith('/'), loc);
    }
    assert.ok(SITE_URL.startsWith('https://') && !SITE_URL.endsWith('/'));
  });

  test('the switched-off background remover is not listed', () => {
    assert.ok(locs.every((l) => !l.includes('background')));
  });

  test('robots.txt points at the sitemap', () => {
    assert.ok(robotsTxt().includes(`Sitemap: ${pageUrl('/sitemap.xml')}`));
  });
});
