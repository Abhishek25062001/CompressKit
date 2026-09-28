import type { PDFImage, PDFPage } from '@cantoo/pdf-lib';
import { familyOf, PdfTextPainter, rgbOf, type TextStyle } from './pdfText';
import type { Geometry, Outline, Paint, Paragraph, Presentation, Run, Shape, TableM, TextBody } from './pptxRead';

/**
 * Draws PowerPoint slides as PDF pages: backgrounds, shapes with their geometry, fills (solid,
 * gradient, picture) and outlines, pictures, tables and text, each turned and flipped as on the
 * slide. Text is real text in the PDF, laid out with the slide's bullets, indents, alignment,
 * spacing and autofit.
 */

type Lib = typeof import('@cantoo/pdf-lib');

export interface SlidesPdfResult {
  bytes: Uint8Array;
  pages: number;
  rasterized: number;
}

// ---------------------------------------------------------------------------------------------
// Geometry: shapes as SVG path data in the shape's own box (0..w, 0..h, y down).

const f = (n: number) => Math.round(n * 100) / 100;

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const k = 0.5522847498;
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  return `M${f(cx - rx)} ${f(cy)}C${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}C${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)}C${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}C${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)}Z`;
}

function roundRectPath(w: number, h: number, r: number): string {
  const k = 0.5522847498 * r;
  if (r <= 0) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return `M${f(r)} 0L${f(w - r)} 0C${f(w - r + k)} 0 ${f(w)} ${f(r - k)} ${f(w)} ${f(r)}L${f(w)} ${f(h - r)}C${f(w)} ${f(h - r + k)} ${f(w - r + k)} ${f(h)} ${f(w - r)} ${f(h)}L${f(r)} ${f(h)}C${f(r - k)} ${f(h)} 0 ${f(h - r + k)} 0 ${f(h - r)}L0 ${f(r)}C0 ${f(r - k)} ${f(r - k)} 0 ${f(r)} 0Z`;
}

const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

function regular(n: number, w: number, h: number, start = -Math.PI / 2): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / n;
    return [w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)] as [number, number];
  });
}

function star(points: number, inner: number, w: number, h: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : 1;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return poly(pts);
}

/** Preset shapes PowerPoint decks use most, with their default adjustments. Unknown ones draw as rectangles. */
export function presetPath(g: Geometry, w: number, h: number): { d: string; open?: boolean } {
  const ss = Math.min(w, h);
  const adj = (name: string, def: number) => (g.adjust[name] ?? def) / 100000;
  switch (g.preset) {
    case 'ellipse':
    case 'flowChartConnector':
      return { d: ellipsePath(0, 0, w, h) };
    case 'roundRect':
    case 'flowChartAlternateProcess':
      return { d: roundRectPath(w, h, ss * adj('adj', 16667)) };
    case 'flowChartTerminator':
      return { d: roundRectPath(w, h, ss / 2) };
    case 'round2SameRect': {
      const r = ss * adj('adj1', 16667);
      const k = 0.5522847498 * r;
      return { d: `M${f(r)} 0L${f(w - r)} 0C${f(w - r + k)} 0 ${f(w)} ${f(r - k)} ${f(w)} ${f(r)}L${f(w)} ${f(h)}L0 ${f(h)}L0 ${f(r)}C0 ${f(r - k)} ${f(r - k)} 0 ${f(r)} 0Z` };
    }
    case 'snip1Rect': {
      const c = ss * adj('adj', 16667);
      return { d: poly([[0, 0], [w - c, 0], [w, c], [w, h], [0, h]]) };
    }
    case 'triangle':
    case 'flowChartExtract':
      return { d: poly([[w * adj('adj', 50000), 0], [w, h], [0, h]]) };
    case 'rtTriangle':
      return { d: poly([[0, 0], [w, h], [0, h]]) };
    case 'diamond':
    case 'flowChartDecision':
      return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) };
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const o = ss * adj('adj', 25000);
      return { d: poly([[o, 0], [w, 0], [w - o, h], [0, h]]) };
    }
    case 'trapezoid': {
      const o = ss * adj('adj', 25000);
      return { d: poly([[o, 0], [w - o, 0], [w, h], [0, h]]) };
    }
    case 'pentagon':
      return { d: poly(regular(5, w, h)) };
    case 'hexagon': {
      const o = ss * adj('adj', 25000);
      return { d: poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]) };
    }
    case 'octagon': {
      const o = ss * adj('adj', 29289);
      return { d: poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]) };
    }
    case 'homePlate': {
      const o = ss * adj('adj', 50000);
      return { d: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) };
    }
    case 'chevron': {
      const o = ss * adj('adj', 50000);
      return { d: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]) };
    }
    case 'rightArrow':
    case 'leftArrow': {
      const t = h * adj('adj1', 50000);
      const head = ss * adj('adj2', 50000);
      const pts: [number, number][] = [[0, (h - t) / 2], [w - head, (h - t) / 2], [w - head, 0], [w, h / 2], [w - head, h], [w - head, (h + t) / 2], [0, (h + t) / 2]];
      return { d: poly(g.preset === 'leftArrow' ? pts.map(([x, y]) => [w - x, y]) : pts) };
    }
    case 'upArrow':
    case 'downArrow': {
      const t = w * adj('adj1', 50000);
      const head = ss * adj('adj2', 50000);
      const pts: [number, number][] = [[(w - t) / 2, h], [(w - t) / 2, head], [0, head], [w / 2, 0], [w, head], [(w + t) / 2, head], [(w + t) / 2, h]];
      return { d: poly(g.preset === 'downArrow' ? pts.map(([x, y]) => [x, h - y]) : pts) };
    }
    case 'plus':
    case 'flowChartSummingJunction': {
      const o = ss * adj('adj', 25000);
      return { d: poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]) };
    }
    case 'star4':
      return { d: star(4, 0.25, w, h) };
    case 'star5':
      return { d: star(5, 0.38, w, h) };
    case 'star6':
      return { d: star(6, 0.58, w, h) };
    case 'donut': {
      const t = ss * adj('adj', 25000);
      return { d: ellipsePath(0, 0, w, h) + ellipsePath(t, t, w - 2 * t, h - 2 * t) };
    }
    case 'frame': {
      const t = ss * adj('adj1', 12500);
      return { d: `M0 0H${f(w)}V${f(h)}H0Z M${f(t)} ${f(t)}V${f(h - t)}H${f(w - t)}V${f(t)}Z` };
    }
    case 'line':
    case 'straightConnector1':
    case 'bentConnector2':
      return { d: `M0 0L${f(w)} ${f(h)}`, open: true };
    case 'bentConnector3':
      return { d: `M0 0L${f(w / 2)} 0L${f(w / 2)} ${f(h)}L${f(w)} ${f(h)}`, open: true };
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout': {
      const dx = adj('adj1', -20833);
      const dy = adj('adj2', 62500);
      const tipX = w / 2 + dx * w;
      const tipY = h / 2 + dy * h;
      const base = g.preset === 'wedgeRoundRectCallout' ? roundRectPath(w, h, ss * 0.1667) : `M0 0H${f(w)}V${f(h)}H0Z`;
      return { d: `${base}M${f(w * 0.35)} ${f(h)}L${f(tipX)} ${f(tipY)}L${f(w * 0.55)} ${f(h)}Z` };
    }
    case 'cloud':
    case 'cloudCallout':
      return { d: ellipsePath(0, 0, w, h) };
    default:
      return { d: `M0 0H${f(w)}V${f(h)}H0Z` };
  }
}

function geometryPath(g: Geometry, w: number, h: number): { d: string; open: boolean } {
  if (g.paths?.length) return { d: scaleCustom(g.paths, w, h), open: g.paths.every((p) => !/Z/i.test(p.d)) };
  const p = presetPath(g, w, h);
  return { d: p.d, open: !!p.open };
}

/**
 * Custom geometry uses its own coordinate space per path; points are scaled to the shape's size.
 * Arc radii scale too, while an arc's flags do not.
 */
function scaleCustom(paths: NonNullable<Geometry['paths']>, w: number, h: number): string {
  return paths
    .map((p) => {
      const sx = w / p.w;
      const sy = h / p.h;
      return p.d.replace(/([MLCQAZ])([^MLCQAZ]*)/g, (_, cmd: string, args: string) => {
        const n = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
        if (cmd === 'A') return `A${f(n[0] * sx)} ${f(n[1] * sy)} ${n[2]} ${n[3]} ${n[4]} ${f(n[5] * sx)} ${f(n[6] * sy)}`;
        return cmd + n.map((v, k) => f(k % 2 === 0 ? v * sx : v * sy)).join(' ');
      });
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------
// Path data to PDF path operators, for clipping (fills and outlines use pdf-lib's own path drawing).

function arcToBeziers(x1: number, y1: number, rx: number, ry: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let rxs = rx * rx;
  let rys = ry * ry;
  const lambda = (dx * dx) / rxs + (dy * dy) / rys;
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
    rxs = rx * rx;
    rys = ry * ry;
  }
  let coef = Math.sqrt(Math.max(0, (rxs * rys - rxs * dy * dy - rys * dx * dx) / (rxs * dy * dy + rys * dx * dx)));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * dy) / ry;
  const cyp = (-coef * ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (dx - cxp) / rx, (dy - cyp) / ry);
  let dt = angle((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: number[][] = [];
  const step = dt / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  let t = t1;
  for (let i = 0; i < segments; i++) {
    const c1 = Math.cos(t);
    const s1 = Math.sin(t);
    const c2 = Math.cos(t + step);
    const s2 = Math.sin(t + step);
    out.push([cx + rx * (c1 - k * s1), cy + ry * (s1 + k * c1), cx + rx * (c2 + k * s2), cy + ry * (s2 - k * c2), cx + rx * c2, cy + ry * s2]);
    t += step;
  }
  return out;
}

/** Absolute M, L, H, V, C, Q, A and Z commands as PDF operators, with y flipped from the top of a box of height `h`. */
function pathOperators(lib: Lib, d: string, h: number) {
  const ops: ReturnType<Lib['moveTo']>[] = [];
  const Y = (y: number) => h - y;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVCQAZ])([^MLHVCQAZ]*)/gi)) {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    switch (cmd.toUpperCase()) {
      case 'M':
        [x, y] = n;
        sx = x;
        sy = y;
        ops.push(lib.moveTo(x, Y(y)));
        for (let i = 2; i + 1 < n.length; i += 2) {
          [x, y] = [n[i], n[i + 1]];
          ops.push(lib.lineTo(x, Y(y)));
        }
        break;
      case 'L':
        for (let i = 0; i + 1 < n.length; i += 2) {
          [x, y] = [n[i], n[i + 1]];
          ops.push(lib.lineTo(x, Y(y)));
        }
        break;
      case 'H':
        x = n[0];
        ops.push(lib.lineTo(x, Y(y)));
        break;
      case 'V':
        y = n[0];
        ops.push(lib.lineTo(x, Y(y)));
        break;
      case 'C':
        for (let i = 0; i + 5 < n.length; i += 6) {
          ops.push(lib.appendBezierCurve(n[i], Y(n[i + 1]), n[i + 2], Y(n[i + 3]), n[i + 4], Y(n[i + 5])));
          [x, y] = [n[i + 4], n[i + 5]];
        }
        break;
      case 'Q':
        for (let i = 0; i + 3 < n.length; i += 4) {
          const [qx, qy, ex, ey] = n.slice(i, i + 4);
          ops.push(lib.appendBezierCurve(x + (2 / 3) * (qx - x), Y(y + (2 / 3) * (qy - y)), ex + (2 / 3) * (qx - ex), Y(ey + (2 / 3) * (qy - ey)), ex, Y(ey)));
          [x, y] = [ex, ey];
        }
        break;
      case 'A':
        for (let i = 0; i + 6 < n.length; i += 7) {
          for (const c of arcToBeziers(x, y, n[i], n[i + 1], !!n[i + 3], !!n[i + 4], n[i + 5], n[i + 6])) {
            ops.push(lib.appendBezierCurve(c[0], Y(c[1]), c[2], Y(c[3]), c[4], Y(c[5])));
          }
          [x, y] = [n[i + 5], n[i + 6]];
        }
        break;
      case 'Z':
        ops.push(lib.closePath());
        x = sx;
        y = sy;
        break;
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Gradients: real PDF shadings (axial or radial) with a stitched function for several stops.

let shadingSeq = 0;

function drawGradient(lib: Lib, page: PDFPage, paint: Extract<Paint, { kind: 'gradient' }>, w: number, h: number, clipOps: ReturnType<typeof pathOperators>): void {
  const { context } = page.doc;
  const { PDFName } = lib;
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const stops = paint.stops.length === 1 ? [paint.stops[0], { ...paint.stops[0], pos: 1 }] : paint.stops;
  const segment = (a: (typeof stops)[number], b: (typeof stops)[number]) => context.obj({ FunctionType: 2, Domain: [0, 1], C0: rgb(a.color), C1: rgb(b.color), N: 1 });
  const fn =
    stops.length === 2
      ? segment(stops[0], stops[1])
      : context.obj({
          FunctionType: 3,
          Domain: [0, 1],
          Functions: stops.slice(1).map((s, i) => segment(stops[i], s)),
          Bounds: stops.slice(1, -1).map((s) => Math.min(1, Math.max(0, s.pos))),
          Encode: stops.slice(1).flatMap(() => [0, 1]),
        });
  let coords: number[];
  if (paint.radial) {
    const r = Math.hypot(w, h) / 2;
    coords = [w / 2, h / 2, 0, w / 2, h / 2, r];
  } else {
    // The angle runs clockwise from the left-to-right direction, on the slide (y down).
    const a = (paint.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    coords = [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
    // Stops at the start of the range sit at its first coordinate.
    const lo = stops[0].pos;
    const hi = stops[stops.length - 1].pos;
    if (lo > 0 || hi < 1) {
      const [x0, y0, x1, y1] = coords;
      coords = [x0 + (x1 - x0) * lo, y0 + (y1 - y0) * lo, x0 + (x1 - x0) * hi, y0 + (y1 - y0) * hi];
    }
  }
  const shading = context.obj({ ShadingType: paint.radial ? 3 : 2, ColorSpace: 'DeviceRGB', Coords: coords, Function: fn, Extend: [true, true] });
  const name = `CkSh${++shadingSeq}`;
  const resources = page.node.Resources()!;
  let dict = resources.lookupMaybe(PDFName.of('Shading'), lib.PDFDict);
  if (!dict) {
    dict = context.obj({});
    resources.set(PDFName.of('Shading'), dict);
  }
  dict.set(PDFName.of(name), context.register(shading));
  page.pushOperators(lib.pushGraphicsState(), ...clipOps, lib.clip(), lib.endPath(), lib.PDFOperator.of(lib.PDFOperatorNames.ShadingFill, [PDFName.of(name)]), lib.popGraphicsState());
}

// ---------------------------------------------------------------------------------------------
// Text.

const WINGDINGS: Record<string, string> = { l: '●', n: '■', q: '❑', u: '◆', v: '❖', Ø: '➢', ü: '✓', '§': '▪', w: '⬥', o: '□', p: '◻', 'è': '➔', 'à': '➢' };

function bulletChar(char: string, font?: string): string {
  if (font && /wingdings/i.test(font)) return WINGDINGS[char] ?? '•';
  if (font && /symbol/i.test(font) && (char === '\u00b7' || char === '\uf0b7')) return '•';
  if (/[\uf000-\uf0ff]/.test(char)) return '•';
  return char;
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of table) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}

function autonumText(type: string, n: number): string {
  const alpha = (k: number) => {
    let s = '';
    while (k > 0) {
      s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
      k = Math.floor((k - 1) / 26);
    }
    return s;
  };
  const core = type.startsWith('alphaLc') ? alpha(n) : type.startsWith('alphaUc') ? alpha(n).toUpperCase() : type.startsWith('romanLc') ? roman(n) : type.startsWith('romanUc') ? roman(n).toUpperCase() : String(n);
  if (type.endsWith('ParenBoth')) return `(${core})`;
  if (type.endsWith('ParenR')) return `${core})`;
  if (type.endsWith('Plain')) return core;
  return `${core}.`;
}

interface Word {
  text: string;
  run: Run;
  width: number;
  space: boolean;
}

interface Line {
  words: Word[];
  width: number;
  /** Largest text size on the line, in points (after autofit). */
  size: number;
  first: boolean;
}

function styleOf(run: Run, scale: number): TextStyle {
  return {
    family: familyOf(run.font),
    bold: run.bold,
    italic: run.italic,
    size: Math.max(1, run.size * scale * (run.baseline ? 0.7 : 1)),
    color: run.color,
    underline: run.underline,
    strike: run.strike,
  };
}

/** Lays out and draws a text body in a box of width `w` and height `h`; y up, origin bottom-left. */
async function drawText(painter: PdfTextPainter, lib: Lib, page: PDFPage, body: TextBody, w: number, h: number, clipToBox: boolean): Promise<void> {
  const scale = body.fontScale;
  const areaW = Math.max(1, w - body.inset.l - body.inset.r);
  const counters: number[] = [];
  const laid: { p: Paragraph; lines: Line[]; bullet?: { text: string; style: TextStyle; x: number }; before: number; after: number; lineH: (l: Line) => number }[] = [];

  for (const p of body.paragraphs) {
    const firstSize = (p.runs.find((r) => r.text.trim())?.size ?? p.endSize) * scale;
    let bullet: (typeof laid)[number]['bullet'];
    // Numbering counts paragraphs of the same level; a paragraph of a lower level restarts deeper ones.
    counters.length = p.level + 1;
    if (p.bullet && 'autonum' in p.bullet) {
      counters[p.level] = (counters[p.level] ?? p.bullet.start - 1) + 1;
    } else counters[p.level] = undefined as unknown as number;
    if (p.bullet) {
      const baseRun = p.runs.find((r) => r.text.trim()) ?? p.runs[0];
      const text = 'char' in p.bullet ? bulletChar(p.bullet.char, p.bullet.font) : autonumText(p.bullet.autonum, counters[p.level]);
      const style: TextStyle = { ...styleOf(baseRun, scale), underline: false, strike: false, size: firstSize * p.bullet.sizePct, color: p.bullet.color ?? baseRun.color };
      bullet = { text, style, x: p.marL + p.indent };
    }
    const textStart = (first: boolean) => {
      if (!first) return p.marL;
      const start = p.marL + p.indent;
      if (!bullet) return start;
      const bw = painter.measure(bullet.text, bullet.style) + firstSize * 0.3;
      return p.indent < 0 && p.marL >= start + bw ? p.marL : start + bw;
    };

    // Words, keeping each run's style, then lines no wider than the box.
    const words: Word[] = [];
    for (const run of p.runs) {
      for (const part of run.text.split(/(\n| +)/)) {
        if (!part) continue;
        if (part === '\n') {
          words.push({ text: '\n', run, width: 0, space: false });
          continue;
        }
        const width = painter.measure(part, styleOf(run, scale));
        words.push({ text: part, run, width, space: /^ +$/.test(part) });
      }
    }
    const lines: Line[] = [];
    let line: Line = { words: [], width: 0, size: 0, first: true };
    const push = () => {
      while (line.words.length && line.words[line.words.length - 1].space) line.width -= line.words.pop()!.width;
      if (!line.size) line.size = (line.words[0]?.run.size ?? p.endSize) * scale;
      lines.push(line);
      line = { words: [], width: 0, size: 0, first: false };
    };
    for (const word of words) {
      if (word.text === '\n') {
        if (!line.size) line.size = word.run.size * scale;
        push();
        continue;
      }
      const limit = areaW - textStart(line.first);
      if (body.wrap && !word.space && line.words.length && line.width + word.width > limit) push();
      if (word.space && !line.words.length && !line.first) continue;
      line.words.push(word);
      line.width += word.width;
      line.size = Math.max(line.size, word.run.size * scale);
    }
    if (line.words.length || !lines.length) push();

    const lineH = (l: Line) => {
      const reduce = 1 - body.spacingReduction;
      if (p.lineSpacing.pts) return p.lineSpacing.pts * reduce;
      return l.size * 1.2 * (p.lineSpacing.pct ?? 1) * reduce;
    };
    const spaceOf = (s: { pts?: number; pct?: number }) => (s.pts ?? 0) + (s.pct ?? 0) * firstSize * 1.2;
    laid.push({ p, lines, bullet, before: spaceOf(p.spaceBefore), after: spaceOf(p.spaceAfter), lineH });
  }

  // Height of all the text, for vertical anchoring.
  let total = 0;
  laid.forEach((l, i) => {
    if (i > 0) total += l.before;
    total += l.lines.reduce((s, line) => s + l.lineH(line), 0);
    if (i < laid.length - 1) total += l.after;
  });
  const areaH = h - body.inset.t - body.inset.b;
  let top = body.inset.t;
  if (body.anchor === 'ctr') top += (areaH - total) / 2;
  else if (body.anchor === 'b') top += areaH - total;

  if (clipToBox) page.pushOperators(lib.pushGraphicsState(), lib.rectangle(0, 0, w, h), lib.clip(), lib.endPath());
  let y = top;
  for (let pi = 0; pi < laid.length; pi++) {
    const { p, lines, bullet, before, after, lineH } = laid[pi];
    if (pi > 0) y += before;
    for (const l of lines) {
      const lh = lineH(l);
      // The first baseline sits about 80% down the line, as in PowerPoint.
      const baseline = y + lh * 0.8 - (lh - l.size * 1.2) * 0.2;
      const start = body.inset.l + (l.first ? (bullet ? p.marL + p.indent : p.marL + p.indent) : p.marL);
      let x = body.inset.l + (l.first ? 0 : p.marL);
      if (l.first) {
        const bw = bullet ? painter.measure(bullet.text, bullet.style) + l.size * 0.3 : 0;
        x = bullet ? (p.indent < 0 && p.marL >= p.marL + p.indent + bw ? body.inset.l + p.marL : start + bw) : start;
      }
      const room = areaW - (x - body.inset.l);
      const free = room - l.width;
      const last = l === lines[lines.length - 1];
      if (p.align === 'ctr') x += free / 2;
      else if (p.align === 'r') x += free;
      const gaps = l.words.filter((wd) => wd.space).length;
      const extra = (p.align === 'just' || p.align === 'dist') && !last && gaps && free > 0 ? free / gaps : 0;

      if (l.first && bullet && l.words.length) {
        await painter.draw(page, bullet.text, body.inset.l + bullet.x, h - baseline, bullet.style);
      }
      for (const word of l.words) {
        const st = styleOf(word.run, scale);
        if (!word.space) {
          if (word.run.highlight) page.drawRectangle({ x, y: h - baseline - st.size * 0.25, width: word.width, height: st.size * 1.15, color: rgbOf(lib, word.run.highlight) });
          const shift = word.run.baseline * word.run.size * scale;
          await painter.draw(page, word.text, x, h - baseline + shift, st);
        }
        x += word.width + (word.space ? extra : 0);
      }
      y += lh;
    }
    if (pi < laid.length - 1) y += after;
  }
  if (clipToBox) page.pushOperators(lib.popGraphicsState());
}

// ---------------------------------------------------------------------------------------------

async function drawImage(page: PDFPage, cache: Map<Uint8Array, PDFImage>, img: { data: Uint8Array; mime: string }, x: number, y: number, w: number, h: number): Promise<void> {
  let embedded = cache.get(img.data);
  if (!embedded) {
    embedded = img.mime === 'image/png' ? await page.doc.embedPng(img.data) : await page.doc.embedJpg(img.data);
    cache.set(img.data, embedded);
  }
  page.drawImage(embedded, { x, y, width: w, height: h });
}

async function fillPath(lib: Lib, page: PDFPage, cache: Map<Uint8Array, PDFImage>, paint: Paint, d: string, w: number, h: number): Promise<void> {
  if (!paint) return;
  if (paint.kind === 'solid') {
    page.drawSvgPath(d, { x: 0, y: h, color: rgbOf(lib, paint.color), opacity: paint.alpha });
  } else if (paint.kind === 'gradient') {
    drawGradient(lib, page, paint, w, h, pathOperators(lib, d, h));
  } else {
    page.pushOperators(lib.pushGraphicsState(), ...pathOperators(lib, d, h), lib.clip(), lib.endPath());
    await drawImage(page, cache, paint, 0, 0, w, h);
    page.pushOperators(lib.popGraphicsState());
  }
}

function strokePath(lib: Lib, page: PDFPage, outline: Outline | null, d: string, h: number): void {
  if (!outline || outline.width <= 0) return;
  page.drawSvgPath(d, {
    x: 0,
    y: h,
    borderColor: rgbOf(lib, outline.color),
    borderWidth: Math.max(0.25, outline.width),
    borderOpacity: outline.alpha,
    borderDashArray: outline.dash,
    borderLineCap: lib.LineCapStyle.Round,
  });
}

async function drawTable(painter: PdfTextPainter, lib: Lib, page: PDFPage, table: TableM, w: number, h: number): Promise<void> {
  const totalW = table.cols.reduce((s, c) => s + c, 0) || w;
  const sx = w / totalW;
  const cols = table.cols.map((c) => c * sx);
  const colX = cols.map((_, i) => cols.slice(0, i).reduce((s, c) => s + c, 0));
  // Rows grow to fit their text, as PowerPoint's do.
  const heights = table.rows.map((row) => {
    let need = row.height;
    row.cells.forEach((cell, c) => {
      if (cell.merged || cell.rowSpan > 1) return;
      const width = cols.slice(c, c + cell.colSpan).reduce((s, x) => s + x, 0) - cell.text.inset.l - cell.text.inset.r;
      let hh = cell.text.inset.t + cell.text.inset.b;
      for (const p of cell.text.paragraphs) {
        const size = (p.runs[0]?.size ?? p.endSize) * cell.text.fontScale;
        const text = p.runs.map((r) => r.text).join('');
        const st = p.runs[0] ? styleOf(p.runs[0], cell.text.fontScale) : { family: 'sans' as const, bold: false, italic: false, size, color: '#000000' };
        hh += painter.wrap(text || ' ', Math.max(1, width), st).length * size * 1.2;
      }
      need = Math.max(need, hh);
    });
    return need;
  });
  const rowY = heights.map((_, i) => heights.slice(0, i).reduce((s, x) => s + x, 0));
  for (let r = 0; r < table.rows.length; r++) {
    for (let c = 0; c < table.rows[r].cells.length; c++) {
      const cell = table.rows[r].cells[c];
      if (cell.merged) continue;
      const cw = cols.slice(c, c + cell.colSpan).reduce((s, x) => s + x, 0);
      const ch = heights.slice(r, r + cell.rowSpan).reduce((s, x) => s + x, 0);
      const x = colX[c];
      const yTop = rowY[r];
      page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(1, 0, 0, 1, x, h - yTop - ch));
      if (cell.fill && cell.fill.kind === 'solid') page.drawRectangle({ x: 0, y: 0, width: cw, height: ch, color: rgbOf(lib, cell.fill.color), opacity: cell.fill.alpha });
      await drawText(painter, lib, page, cell.text, cw, ch, false);
      const edge = (o: Outline | undefined, x1: number, y1: number, x2: number, y2: number) => {
        if (o && o.width > 0) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.width, color: rgbOf(lib, o.color), opacity: o.alpha, dashArray: o.dash });
      };
      edge(cell.borders.t, 0, ch, cw, ch);
      edge(cell.borders.b, 0, 0, cw, 0);
      edge(cell.borders.l, 0, 0, 0, ch);
      edge(cell.borders.r, cw, 0, cw, ch);
      page.pushOperators(lib.popGraphicsState());
    }
  }
}

export async function slidesToPdf(pres: Presentation, onProgress?: (ratio: number) => void): Promise<SlidesPdfResult> {
  const lib: Lib = await import('@cantoo/pdf-lib');
  const out = await lib.PDFDocument.create();
  out.setProducer('CompressKit');
  out.setCreator('CompressKit (in-browser)');
  const painter = new PdfTextPainter(lib, out);
  const cache = new Map<Uint8Array, PDFImage>();
  const W = pres.width;
  const H = pres.height;

  for (let i = 0; i < pres.slides.length; i++) {
    const slide = pres.slides[i];
    const page = out.addPage([W, H]);
    if (slide.background) await fillPath(lib, page, cache, slide.background, `M0 0H${W}V${H}H0Z`, W, H);

    for (const shape of slide.shapes) await drawShape(painter, lib, page, cache, shape, H);
    onProgress?.((i + 1) / pres.slides.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pages: out.getPageCount(), rasterized: painter.rasterized };
}

async function drawShape(painter: PdfTextPainter, lib: Lib, page: PDFPage, cache: Map<Uint8Array, PDFImage>, s: Shape, H: number): Promise<void> {
  const w = Math.max(0.01, s.w);
  const h = Math.max(0.01, s.h);
  // Local coordinates: the shape's box with its bottom-left at the origin, turned about its centre.
  const cx = s.x + s.w / 2;
  const cy = H - (s.y + s.h / 2);
  const rad = (-s.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const transform = (flipH: boolean, flipV: boolean) => {
    const fx = flipH ? -1 : 1;
    const fy = flipV ? -1 : 1;
    // translate(cx, cy) · rotate · scale(fx, fy) · translate(−w/2, −h/2)
    const a = cos * fx;
    const b = sin * fx;
    const c = -sin * fy;
    const d = cos * fy;
    const e = cx + a * (-w / 2) + c * (-h / 2);
    const ff = cy + b * (-w / 2) + d * (-h / 2);
    return lib.concatTransformationMatrix(a, b, c, d, e, ff);
  };

  page.pushOperators(lib.pushGraphicsState(), transform(s.flipH, s.flipV));
  if (s.kind === 'table' && s.table) {
    page.pushOperators(lib.popGraphicsState(), lib.pushGraphicsState(), transform(false, false));
    await drawTable(painter, lib, page, s.table, w, h);
    page.pushOperators(lib.popGraphicsState());
    return;
  }
  const geo = geometryPath(s.geometry, w, h);
  if (s.kind === 'picture' && s.picture) {
    const { crop } = s.picture;
    const iw = w / Math.max(0.01, 1 - crop.l - crop.r);
    const ih = h / Math.max(0.01, 1 - crop.t - crop.b);
    page.pushOperators(lib.pushGraphicsState(), ...pathOperators(lib, geo.d, h), lib.clip(), lib.endPath());
    await drawImage(page, cache, s.picture, -crop.l * iw, -crop.b * ih, iw, ih);
    page.pushOperators(lib.popGraphicsState());
  } else if (!geo.open) {
    await fillPath(lib, page, cache, s.fill, geo.d, w, h);
  }
  strokePath(lib, page, s.outline, geo.d, h);
  page.pushOperators(lib.popGraphicsState());

  // Text turns with its shape but is never mirrored.
  if (s.text && s.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) {
    page.pushOperators(lib.pushGraphicsState(), transform(false, false));
    if (s.text.vertical) {
      // Vertical text: the text box is turned inside the shape, so lines run down (90°) or up (270°).
      const turn = s.text.vertical === 90 ? -1 : 1;
      page.pushOperators(lib.concatTransformationMatrix(0, turn, -turn, 0, turn === -1 ? 0 : w, turn === -1 ? h : 0));
      await drawText(painter, lib, page, s.text, h, w, false);
    } else {
      await drawText(painter, lib, page, s.text, w, h, false);
    }
    page.pushOperators(lib.popGraphicsState());
  }
}
