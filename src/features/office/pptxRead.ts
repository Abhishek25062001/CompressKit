import { strFromU8, unzipSync } from 'fflate';

/**
 * Reads PowerPoint presentations (.pptx) into slides ready to draw: every shape with its position
 * on the slide (groups resolved), fill, outline, geometry, picture or table, and its text with the
 * styles it inherits from the slide layout, the slide master and the theme, the way PowerPoint
 * resolves them. Charts, SmartArt without a drawing fallback, video and audio are left out.
 */

export class PptxReadError extends Error {}

export interface Stop {
  pos: number;
  color: string;
  alpha: number;
}

export type Paint =
  | { kind: 'solid'; color: string; alpha: number }
  | { kind: 'gradient'; stops: Stop[]; angle: number; radial: boolean }
  | { kind: 'image'; data: Uint8Array; mime: 'image/png' | 'image/jpeg' }
  | null;

export interface Outline {
  color: string;
  alpha: number;
  /** Points. */
  width: number;
  dash?: number[];
  headEnd?: boolean;
  tailEnd?: boolean;
}

export interface Run {
  text: string;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  alpha: number;
  font: string;
  /** Superscript (positive) or subscript (negative), as a fraction of the size. */
  baseline: number;
  caps: boolean;
  highlight?: string;
}

export interface Paragraph {
  runs: Run[];
  align: 'l' | 'ctr' | 'r' | 'just' | 'dist';
  level: number;
  /** Left margin and first-line indent, in points. */
  marL: number;
  indent: number;
  bullet: { char: string; color?: string; sizePct: number; font?: string } | { autonum: string; start: number; color?: string; sizePct: number } | null;
  spaceBefore: { pts?: number; pct?: number };
  spaceAfter: { pts?: number; pct?: number };
  lineSpacing: { pts?: number; pct?: number };
  /** Size of the paragraph's empty line when it has no runs. */
  endSize: number;
}

export interface TextBody {
  paragraphs: Paragraph[];
  inset: { l: number; t: number; r: number; b: number };
  anchor: 't' | 'ctr' | 'b';
  anchorCenter: boolean;
  wrap: boolean;
  /** From "shrink text on overflow" (normAutofit). */
  fontScale: number;
  spacingReduction: number;
  /** Vertical text, turned 90° or 270°. */
  vertical: 0 | 90 | 270;
  /** Grow the shape to fit the text (spAutoFit) — the text is kept whole rather than clipped. */
  autoGrow: boolean;
}

export interface Geometry {
  preset?: string;
  adjust: Record<string, number>;
  /** Custom geometry: SVG path data per path, in the path's own width and height. */
  paths?: { d: string; w: number; h: number; fill: boolean; stroke: boolean }[];
}

export interface TableCellM {
  text: TextBody;
  fill: Paint;
  borders: { l?: Outline; r?: Outline; t?: Outline; b?: Outline };
  colSpan: number;
  rowSpan: number;
  /** Covered by a neighbour's span. */
  merged: boolean;
}

export interface TableM {
  cols: number[];
  rows: { height: number; cells: TableCellM[] }[];
}

export interface Shape {
  kind: 'shape' | 'picture' | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise degrees. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
  geometry: Geometry;
  fill: Paint;
  outline: Outline | null;
  text?: TextBody;
  picture?: { data: Uint8Array; mime: 'image/png' | 'image/jpeg'; crop: { l: number; t: number; r: number; b: number } };
  table?: TableM;
}

export interface SlideM {
  background: Paint;
  shapes: Shape[];
}

export interface Presentation {
  width: number;
  height: number;
  slides: SlideM[];
  warnings: string[];
}

type Files = Record<string, Uint8Array>;
type El = Element;

const EMU = 12700;
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const kids = (el: El | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: El | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
const path = (el: El | undefined, ...names: string[]) => names.reduce<El | undefined>((e, n) => kid(e, n), el);
const attr = (el: El | undefined, name: string) => el?.getAttribute(name) ?? null;
const num = (el: El | undefined, name: string, fallback: number) => {
  const v = attr(el, name);
  return v === null ? fallback : Number(v);
};

function parse(files: Files, p: string): Document | null {
  const data = files[p];
  return data ? new DOMParser().parseFromString(strFromU8(data), 'application/xml') : null;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const p of (dir + target).split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

function relsOf(files: Files, part: string): Map<string, { target: string; type: string }> {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const doc = parse(files, `${dir}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`);
  const map = new Map<string, { target: string; type: string }>();
  if (!doc) return map;
  for (const r of Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    map.set(r.getAttribute('Id') ?? '', { target: resolvePath(dir, r.getAttribute('Target') ?? ''), type: r.getAttribute('Type') ?? '' });
  }
  return map;
}

// ---------------------------------------------------------------------------------------------
// Colours.

interface Theme {
  colors: Record<string, string>;
  major: string;
  minor: string;
  fills: El[];
  lines: El[];
  bgFills: El[];
}

const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0', maroon: '800000', teal: '008080',
};

function rgbToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return `${to(r)}${to(g)}${to(b)}`;
}

class Context {
  files: Files;
  theme: Theme;
  /** The slide master's colour map: bg1 → lt1, tx1 → dk1… Layouts and slides may override it. */
  clrMap: Record<string, string>;
  constructor(files: Files, theme: Theme, clrMap: Record<string, string>) {
    this.files = files;
    this.theme = theme;
    this.clrMap = clrMap;
  }

  /** A colour element (srgbClr, schemeClr, sysClr, prstClr, scrgbClr, hslClr) with its modifiers. */
  color(parent: El | undefined, placeholder?: string): { color: string; alpha: number } | null {
    if (!parent) return null;
    const el = Array.from(parent.children).find((c) => /Clr$/.test(c.localName));
    if (!el) return null;
    let hex: string;
    switch (el.localName) {
      case 'srgbClr':
        hex = attr(el, 'val') ?? '000000';
        break;
      case 'sysClr':
        hex = attr(el, 'lastClr') ?? (attr(el, 'val') === 'window' ? 'FFFFFF' : '000000');
        break;
      case 'prstClr':
        hex = PRESET_COLORS[attr(el, 'val') ?? ''] ?? '000000';
        break;
      case 'scrgbClr': {
        const c = (k: string) => Math.round(Math.min(1, num(el, k, 0) / 100000) ** (1 / 2.2) * 255).toString(16).padStart(2, '0');
        hex = `${c('r')}${c('g')}${c('b')}`;
        break;
      }
      case 'hslClr':
        hex = hslToHex(num(el, 'hue', 0) / 21600000, num(el, 'sat', 0) / 100000, num(el, 'lum', 0) / 100000);
        break;
      case 'schemeClr': {
        let name = attr(el, 'val') ?? 'tx1';
        if (name === 'phClr') {
          if (!placeholder) return null;
          hex = placeholder;
          break;
        }
        name = this.clrMap[name] ?? name;
        hex = this.theme.colors[name] ?? '000000';
        break;
      }
      default:
        return null;
    }
    let alpha = 1;
    // Modifiers apply in order. Tint and shade mix in linear light (as PowerPoint does); the
    // luminance and saturation ones work on hue, saturation and lightness.
    const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
    const channels = () => {
      const n = parseInt(hex, 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const fromChannels = (c: number[]) => c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
    for (const m of Array.from(el.children)) {
      const v = num(m, 'val', 0) / 100000;
      switch (m.localName) {
        case 'alpha':
          alpha = v;
          break;
        case 'tint':
          hex = fromChannels(channels().map((c) => toSrgb(toLinear(c) * v + (1 - v))));
          break;
        case 'shade':
          hex = fromChannels(channels().map((c) => toSrgb(toLinear(c) * v)));
          break;
        case 'lumMod':
        case 'lumOff':
        case 'satMod': {
          const [h, sat, l] = rgbToHsl(hex);
          if (m.localName === 'lumMod') hex = hslToHex(h, sat, Math.min(1, Math.max(0, l * v)));
          else if (m.localName === 'lumOff') hex = hslToHex(h, sat, Math.min(1, Math.max(0, l + v)));
          else hex = hslToHex(h, Math.min(1, Math.max(0, sat * v)), l);
          break;
        }
      }
    }
    return { color: `#${hex.toLowerCase()}`, alpha };
  }
}

// ---------------------------------------------------------------------------------------------
// Fills and outlines.

function blipImage(ctx: Context, blip: El | undefined, rels: Map<string, { target: string }>): { data: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null {
  if (!blip) return null;
  const id = blip.getAttributeNS(NS_R, 'embed') ?? blip.getAttribute('r:embed');
  const target = id ? rels.get(id)?.target : undefined;
  const data = target ? ctx.files[target] : undefined;
  if (!data) return null;
  if (data[0] === 0x89 && data[1] === 0x50) return { data, mime: 'image/png' };
  if (data[0] === 0xff && data[1] === 0xd8) return { data, mime: 'image/jpeg' };
  return null;
}

function readFill(ctx: Context, parent: El | undefined, rels: Map<string, { target: string }>, placeholder?: string): Paint | undefined {
  if (!parent) return undefined;
  for (const c of Array.from(parent.children)) {
    switch (c.localName) {
      case 'noFill':
        return null;
      case 'solidFill': {
        const col = ctx.color(c, placeholder);
        return col ? { kind: 'solid', ...col } : null;
      }
      case 'gradFill': {
        const stops = kids(kid(c, 'gsLst'), 'gs')
          .map((gs) => ({ pos: num(gs, 'pos', 0) / 100000, ...(ctx.color(gs, placeholder) ?? { color: '#ffffff', alpha: 1 }) }))
          .sort((a, b) => a.pos - b.pos);
        if (!stops.length) return null;
        const lin = kid(c, 'lin');
        return { kind: 'gradient', stops, angle: num(lin, 'ang', 5400000) / 60000, radial: !!kid(c, 'path') };
      }
      case 'blipFill': {
        const img = blipImage(ctx, kid(c, 'blip'), rels);
        return img ? { kind: 'image', ...img } : null;
      }
      case 'pattFill': {
        // Drawn as its foreground colour; the pattern itself is too fine to matter on a slide.
        const col = ctx.color(kid(c, 'fgClr'), placeholder);
        return col ? { kind: 'solid', ...col } : null;
      }
      case 'grpFill':
        return undefined;
    }
  }
  return undefined;
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dot: [1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

function readOutline(ctx: Context, ln: El | undefined, placeholder?: string): Outline | null | undefined {
  if (!ln) return undefined;
  const fill = Array.from(ln.children).find((c) => c.localName === 'noFill' || c.localName === 'solidFill' || c.localName === 'gradFill');
  if (fill?.localName === 'noFill') return null;
  const width = num(ln, 'w', 9525) / EMU;
  const col = fill?.localName === 'solidFill' ? ctx.color(fill, placeholder) : fill?.localName === 'gradFill' ? ctx.color(path(fill, 'gsLst', 'gs'), placeholder) : null;
  if (!col) return undefined;
  const dash = attr(kid(ln, 'prstDash'), 'val');
  return {
    ...col,
    width,
    dash: dash && DASHES[dash] ? DASHES[dash].map((d) => d * Math.max(1, width)) : undefined,
    headEnd: !!attr(kid(ln, 'headEnd'), 'type') && attr(kid(ln, 'headEnd'), 'type') !== 'none',
    tailEnd: !!attr(kid(ln, 'tailEnd'), 'type') && attr(kid(ln, 'tailEnd'), 'type') !== 'none',
  };
}

/** Theme style references (<p:style>): fillRef and lnRef pick theme styles, coloured by their own colour. */
function styleRefs(ctx: Context, sp: El, rels: Map<string, { target: string }>): { fill?: Paint; outline?: Outline | null; fontColor?: string } {
  const style = kid(sp, 'style');
  if (!style) return {};
  const out: { fill?: Paint; outline?: Outline | null; fontColor?: string } = {};
  const fillRef = kid(style, 'fillRef');
  if (fillRef) {
    const idx = num(fillRef, 'idx', 0);
    const ph = ctx.color(fillRef)?.color.slice(1);
    const list = idx >= 1000 ? ctx.theme.bgFills : ctx.theme.fills;
    const tpl = list[(idx >= 1000 ? idx - 1000 : idx) - 1];
    if (idx === 0) out.fill = null;
    else if (tpl) {
      const holder = document.implementation.createDocument(null, 'x');
      holder.documentElement.appendChild(holder.importNode(tpl, true));
      out.fill = readFill(ctx, holder.documentElement, rels, ph);
    }
  }
  const lnRef = kid(style, 'lnRef');
  if (lnRef) {
    const idx = num(lnRef, 'idx', 0);
    const ph = ctx.color(lnRef)?.color.slice(1);
    const tpl = ctx.theme.lines[idx - 1];
    out.outline = idx === 0 || !tpl ? null : (readOutline(ctx, tpl, ph) ?? null);
  }
  const fontRef = kid(style, 'fontRef');
  if (fontRef) out.fontColor = ctx.color(fontRef)?.color;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Text styles: a level's paragraph and run properties, merged along the inheritance chain.

/** Properties for levels 1–9 from a list style (txStyles entries, lstStyle), weakest first. */
function levelsOf(list: El | undefined): (El | undefined)[] {
  return Array.from({ length: 9 }, (_, i) => kid(list, `lvl${i + 1}pPr`));
}

interface TextDefaults {
  /** Chains of lvlNpPr elements, weakest first, per level (0–8). */
  levels: (El | undefined)[][];
  bodyPr: El[];
  fontColor?: string;
}

function firstAttr(chain: (El | undefined)[], name: string): string | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = attr(chain[i], name);
    if (v !== null) return v;
  }
  return null;
}

function firstChild(chain: (El | undefined)[], name: string): El | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = kid(chain[i], name);
    if (c) return c;
  }
  return undefined;
}

function spacing(el: El | undefined): { pts?: number; pct?: number } | undefined {
  if (!el) return undefined;
  const pts = kid(el, 'spcPts');
  if (pts) return { pts: num(pts, 'val', 0) / 100 };
  const pct = kid(el, 'spcPct');
  if (pct) return { pct: num(pct, 'val', 100000) / 100000 };
  return undefined;
}

function themeFont(ctx: Context, face: string | null): string {
  if (!face) return ctx.theme.minor;
  if (face.startsWith('+mj')) return ctx.theme.major;
  if (face.startsWith('+mn')) return ctx.theme.minor;
  return face;
}

function readTextBody(ctx: Context, txBody: El | undefined, defaults: TextDefaults): TextBody | undefined {
  if (!txBody) return undefined;
  const bodyChain = [...defaults.bodyPr, kid(txBody, 'bodyPr')].filter(Boolean) as El[];
  const b = (name: string) => firstAttr(bodyChain, name);
  const inset = {
    l: Number(b('lIns') ?? 91440) / EMU,
    t: Number(b('tIns') ?? 45720) / EMU,
    r: Number(b('rIns') ?? 91440) / EMU,
    b: Number(b('bIns') ?? 45720) / EMU,
  };
  const norm = firstChild(bodyChain, 'normAutofit');
  const vert = b('vert');
  const lstStyle = levelsOf(kid(txBody, 'lstStyle'));

  const paragraphs: Paragraph[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const level = Math.min(8, num(pPr, 'lvl', 0));
    const chain = [...defaults.levels[level], lstStyle[level], pPr];
    const pa = (name: string) => firstAttr(chain, name);
    const defRPrChain = chain.map((c) => kid(c, 'defRPr'));

    const runs: Run[] = [];
    const runOf = (rPr: El | undefined, text: string) => {
      const rc = [...defRPrChain, rPr];
      const ra = (name: string) => firstAttr(rc, name);
      // A shape's theme font colour (fontRef) beats the master's and presentation's defaults, but
      // not a colour set on the shape's own text.
      const ownFill = firstChild([kid(lstStyle[level], 'defRPr'), kid(pPr, 'defRPr'), rPr], 'solidFill');
      const inheritedFill = firstChild(defRPrChain.slice(0, defaults.levels[level].length), 'solidFill');
      const fromEl = ownFill ?? (defaults.fontColor ? undefined : inheritedFill);
      const col =
        (fromEl ? ctx.color(fromEl) : null) ??
        (defaults.fontColor ? { color: defaults.fontColor, alpha: 1 } : { color: `#${(ctx.theme.colors[ctx.clrMap.tx1 ?? 'dk1'] ?? '000000').toLowerCase()}`, alpha: 1 });
      const latin = firstChild(rc, 'latin');
      const highlight = firstChild(rc, 'highlight');
      const u = ra('u');
      runs.push({
        text: ra('cap') === 'all' ? text.toUpperCase() : text,
        size: Number(ra('sz') ?? 1800) / 100,
        bold: ra('b') === '1' || ra('b') === 'true',
        italic: ra('i') === '1' || ra('i') === 'true',
        underline: !!u && u !== 'none',
        strike: !!ra('strike') && ra('strike') !== 'noStrike',
        color: col.color,
        alpha: col.alpha,
        font: themeFont(ctx, attr(latin, 'typeface')),
        baseline: Number(ra('baseline') ?? 0) / 100000,
        caps: ra('cap') === 'small',
        highlight: highlight ? ctx.color(highlight)?.color : undefined,
      });
    };
    for (const r of Array.from(p.children)) {
      if (r.localName === 'r') runOf(kid(r, 'rPr'), kid(r, 't')?.textContent ?? '');
      else if (r.localName === 'br') runOf(kid(r, 'rPr'), '\n');
      else if (r.localName === 'fld') runOf(kid(r, 'rPr'), kid(r, 't')?.textContent ?? '');
    }

    let bullet: Paragraph['bullet'] = null;
    const buNone = firstChild(chain, 'buNone');
    const buChar = firstChild(chain, 'buChar');
    const buAuto = firstChild(chain, 'buAutoNum');
    // The nearest bullet setting wins; buNone after buChar in the chain turns bullets off.
    const nearest = [...chain].reverse().map((c) => (c ? Array.from(c.children).find((k) => k.localName === 'buNone' || k.localName === 'buChar' || k.localName === 'buAutoNum') : undefined)).find(Boolean);
    const buClr = firstChild(chain, 'buClr');
    const buSzPct = firstChild(chain, 'buSzPct');
    const sizePct = buSzPct ? num(buSzPct, 'val', 100000) / 100000 : 1;
    const buColor = buClr ? ctx.color(buClr)?.color : undefined;
    if (nearest && nearest !== buNone && runs.some((r) => r.text.trim())) {
      if (nearest === buChar) bullet = { char: attr(buChar, 'char') ?? '•', color: buColor, sizePct, font: attr(firstChild(chain, 'buFont'), 'typeface') ?? undefined };
      else if (nearest === buAuto) bullet = { autonum: attr(buAuto, 'type') ?? 'arabicPeriod', start: num(buAuto, 'startAt', 1), color: buColor, sizePct };
    }

    const endRPr = kid(p, 'endParaRPr');
    const endSize = Number(firstAttr([...defRPrChain, endRPr], 'sz') ?? 1800) / 100;
    const algn = (pa('algn') ?? 'l') as Paragraph['align'];
    paragraphs.push({
      runs,
      align: ['l', 'ctr', 'r', 'just', 'dist'].includes(algn) ? algn : 'l',
      level,
      marL: Number(pa('marL') ?? 0) / EMU,
      indent: Number(pa('indent') ?? 0) / EMU,
      bullet,
      spaceBefore: spacing(firstChild(chain, 'spcBef')) ?? {},
      spaceAfter: spacing(firstChild(chain, 'spcAft')) ?? {},
      lineSpacing: spacing(firstChild(chain, 'lnSpc')) ?? {},
      endSize,
    });
  }
  return {
    paragraphs,
    inset,
    anchor: (b('anchor') as TextBody['anchor']) ?? 't',
    anchorCenter: b('anchorCtr') === '1',
    wrap: b('wrap') !== 'none',
    fontScale: norm ? num(norm, 'fontScale', 100000) / 100000 : 1,
    spacingReduction: norm ? num(norm, 'lnSpcReduction', 0) / 100000 : 0,
    vertical: vert === 'vert' || vert === 'eaVert' ? 90 : vert === 'vert270' ? 270 : 0,
    autoGrow: !!firstChild(bodyChain, 'spAutoFit'),
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry.

function readGeometry(spPr: El | undefined): Geometry {
  const prst = kid(spPr, 'prstGeom');
  if (prst) {
    const adjust: Record<string, number> = {};
    for (const gd of kids(kid(prst, 'avLst'), 'gd')) {
      const m = /val\s+(-?\d+)/.exec(attr(gd, 'fmla') ?? '');
      if (m) adjust[attr(gd, 'name') ?? ''] = Number(m[1]);
    }
    return { preset: attr(prst, 'prst') ?? 'rect', adjust };
  }
  const cust = kid(spPr, 'custGeom');
  if (cust) {
    const paths = kids(kid(cust, 'pathLst'), 'path').map((p) => {
      const w = num(p, 'w', 1) || 1;
      const h = num(p, 'h', 1) || 1;
      let d = '';
      let cx = 0;
      let cy = 0;
      const pt = (el: El | undefined) => [num(el, 'x', 0), num(el, 'y', 0)];
      for (const cmd of Array.from(p.children)) {
        const pts = kids(cmd, 'pt').map(pt);
        switch (cmd.localName) {
          case 'moveTo':
            [cx, cy] = pts[0];
            d += `M${cx} ${cy}`;
            break;
          case 'lnTo':
            [cx, cy] = pts[0];
            d += `L${cx} ${cy}`;
            break;
          case 'cubicBezTo':
            d += `C${pts.map((q) => q.join(' ')).join(' ')}`;
            [cx, cy] = pts[2];
            break;
          case 'quadBezTo':
            d += `Q${pts.map((q) => q.join(' ')).join(' ')}`;
            [cx, cy] = pts[1];
            break;
          case 'arcTo': {
            // DrawingML arcs start at the current point on an ellipse and sweep by an angle.
            const wR = num(cmd, 'wR', 0);
            const hR = num(cmd, 'hR', 0);
            const st = (num(cmd, 'stAng', 0) / 60000) * (Math.PI / 180);
            const sw = (num(cmd, 'swAng', 0) / 60000) * (Math.PI / 180);
            const ecx = cx - wR * Math.cos(st);
            const ecy = cy - hR * Math.sin(st);
            const ex = ecx + wR * Math.cos(st + sw);
            const ey = ecy + hR * Math.sin(st + sw);
            d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`;
            cx = ex;
            cy = ey;
            break;
          }
          case 'close':
            d += 'Z';
            break;
        }
      }
      return { d, w, h, fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false' };
    });
    return { paths, adjust: {} };
  }
  return { preset: 'rect', adjust: {} };
}

// ---------------------------------------------------------------------------------------------
// Placeholders and inheritance.

interface Part {
  path: string;
  doc: Document;
  rels: Map<string, { target: string; type: string }>;
}

interface PlaceholderInfo {
  sp: El;
  type: string;
  idx: string | null;
}

function placeholders(tree: El | undefined): PlaceholderInfo[] {
  const out: PlaceholderInfo[] = [];
  const walk = (el: El | undefined) => {
    for (const c of Array.from(el?.children ?? [])) {
      if (c.localName === 'grpSp') walk(c);
      const nv = Array.from(c.children).find((k) => /^nv/.test(k.localName));
      const ph = path(nv, 'nvPr', 'ph');
      if (ph) out.push({ sp: c, type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') });
    }
  };
  walk(tree);
  return out;
}

/** The layout or master placeholder a placeholder inherits from: same index, else same type. */
function findPlaceholder(list: PlaceholderInfo[], type: string, idx: string | null): PlaceholderInfo | undefined {
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
  return (idx !== null ? list.find((p) => p.idx === idx) : undefined) ?? list.find((p) => p.type === type) ?? list.find((p) => norm(p.type) === norm(type));
}

const spTree = (doc: Document) => doc.getElementsByTagNameNS('*', 'spTree')[0] as El | undefined;

// ---------------------------------------------------------------------------------------------

interface Frame {
  /** Maps a child's position and size into slide coordinates (for groups). */
  map: (x: number, y: number, w: number, h: number) => { x: number; y: number; w: number; h: number };
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

const IDENTITY: Frame = { map: (x, y, w, h) => ({ x, y, w, h }), rot: 0, flipH: false, flipV: false };

function xfrmOf(spPr: El | undefined) {
  const x = kid(spPr, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  return {
    x: num(off, 'x', 0) / EMU,
    y: num(off, 'y', 0) / EMU,
    w: num(ext, 'cx', 0) / EMU,
    h: num(ext, 'cy', 0) / EMU,
    rot: num(x, 'rot', 0) / 60000,
    flipH: attr(x, 'flipH') === '1',
    flipV: attr(x, 'flipV') === '1',
    chOff: kid(x, 'chOff'),
    chExt: kid(x, 'chExt'),
  };
}

export function readPptx(bytes: Uint8Array): Presentation {
  let files: Files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new PptxReadError('not a zip');
  }
  const rootRels = relsOf(files, '');
  const presPath = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'ppt/presentation.xml';
  const pres = parse(files, presPath);
  if (!pres) throw new PptxReadError('no presentation');
  const presRels = relsOf(files, presPath);
  const sz = pres.getElementsByTagNameNS('*', 'sldSz')[0];
  const width = num(sz, 'cx', 9144000) / EMU;
  const height = num(sz, 'cy', 6858000) / EMU;
  const defaultTextStyle = pres.getElementsByTagNameNS('*', 'defaultTextStyle')[0] as El | undefined;
  const warnings = new Set<string>();

  const partCache = new Map<string, Part>();
  const part = (p: string): Part | null => {
    if (partCache.has(p)) return partCache.get(p)!;
    const doc = parse(files, p);
    if (!doc) return null;
    const result = { path: p, doc, rels: relsOf(files, p) };
    partCache.set(p, result);
    return result;
  };

  const themeOf = (master: Part): Theme => {
    const themePath = [...master.rels.values()].find((r) => r.type.endsWith('/theme'))?.target;
    const doc = themePath ? parse(files, themePath) : null;
    const colors: Record<string, string> = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };
    let major = 'Calibri Light';
    let minor = 'Calibri';
    let fills: El[] = [];
    let lines: El[] = [];
    let bgFills: El[] = [];
    if (doc) {
      const scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
      for (const c of Array.from(scheme?.children ?? [])) {
        const v = c.firstElementChild;
        if (v) colors[c.localName] = attr(v, 'lastClr') ?? attr(v, 'val') ?? colors[c.localName];
      }
      major = attr(path(doc.getElementsByTagNameNS('*', 'majorFont')[0] as El, 'latin'), 'typeface') ?? major;
      minor = attr(path(doc.getElementsByTagNameNS('*', 'minorFont')[0] as El, 'latin'), 'typeface') ?? minor;
      fills = Array.from(doc.getElementsByTagNameNS('*', 'fillStyleLst')[0]?.children ?? []);
      lines = Array.from(doc.getElementsByTagNameNS('*', 'lnStyleLst')[0]?.children ?? []);
      bgFills = Array.from(doc.getElementsByTagNameNS('*', 'bgFillStyleLst')[0]?.children ?? []);
    }
    return { colors, major, minor, fills, lines, bgFills };
  };

  const clrMapOf = (el: El | undefined, base: Record<string, string>) => {
    if (!el) return base;
    const map: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) map[a.name] = a.value;
    return map;
  };

  const slides: SlideM[] = [];
  const ids = kids(pres.getElementsByTagNameNS('*', 'sldIdLst')[0] as El, 'sldId');
  for (const sid of ids) {
    const rid = sid.getAttributeNS(NS_R, 'id') ?? sid.getAttribute('r:id') ?? '';
    const slidePath = presRels.get(rid)?.target;
    const slide = slidePath ? part(slidePath) : null;
    if (!slide) continue;
    const slideRoot = slide.doc.documentElement;
    // Hidden slides are left out, as PowerPoint does when saving a PDF.
    if (attr(slideRoot, 'show') === '0') continue;
    const layoutPath = [...slide.rels.values()].find((r) => r.type.endsWith('/slideLayout'))?.target;
    const layout = layoutPath ? part(layoutPath) : null;
    const masterPath = layout ? [...layout.rels.values()].find((r) => r.type.endsWith('/slideMaster'))?.target : undefined;
    const master = masterPath ? part(masterPath) : null;
    if (!layout || !master) continue;

    const theme = themeOf(master);
    const masterMap = clrMapOf(master.doc.getElementsByTagNameNS('*', 'clrMap')[0] as El, {});
    const override = (doc: Document) => path(doc.documentElement, 'clrMapOvr', 'overrideClrMapping');
    const clrMap = clrMapOf(override(slide.doc) ?? override(layout.doc), masterMap);
    const ctx = new Context(files, theme, clrMap);

    const txStyles = master.doc.getElementsByTagNameNS('*', 'txStyles')[0] as El | undefined;
    const styleFor = (type: string | null): (El | undefined)[] => {
      if (type === 'title' || type === 'ctrTitle') return levelsOf(kid(txStyles, 'titleStyle'));
      if (type && type !== 'none') return levelsOf(kid(txStyles, 'bodyStyle'));
      return levelsOf(kid(txStyles, 'otherStyle'));
    };
    const masterPh = placeholders(spTree(master.doc));
    const layoutPh = placeholders(spTree(layout.doc));

    // Background: the slide's own, else the layout's, else the master's.
    const bgOf = (p: Part): Paint | undefined => {
      const bg = path(p.doc.documentElement, 'cSld', 'bg');
      if (!bg) return undefined;
      const bgPr = kid(bg, 'bgPr');
      if (bgPr) return readFill(ctx, bgPr, p.rels);
      const ref = kid(bg, 'bgRef');
      if (ref) {
        const idx = num(ref, 'idx', 0);
        const ph = ctx.color(ref)?.color.slice(1);
        const tpl = idx >= 1001 ? theme.bgFills[idx - 1001] : theme.fills[idx - 1];
        if (!tpl) return ph ? { kind: 'solid', color: `#${ph}`, alpha: 1 } : undefined;
        const holder = document.implementation.createDocument(null, 'x');
        holder.documentElement.appendChild(holder.importNode(tpl, true));
        return readFill(ctx, holder.documentElement, p.rels, ph);
      }
      return undefined;
    };
    const background = bgOf(slide) ?? bgOf(layout) ?? bgOf(master) ?? { kind: 'solid', color: `#${(theme.colors[clrMap.bg1 ?? 'lt1'] ?? 'FFFFFF').toLowerCase()}`, alpha: 1 };

    const shapes: Shape[] = [];
    const readTree = (tree: El | undefined, p: Part, level: 'master' | 'layout' | 'slide', frame: Frame) => {
      for (const el of Array.from(tree?.children ?? [])) {
        const name = el.localName;
        if (name === 'AlternateContent') {
          // Newer features come with a fallback that older readers (and this one) can draw.
          const fallback = kid(el, 'Fallback') ?? kid(el, 'Choice');
          if (fallback) readTree(fallback, p, level, frame);
          continue;
        }
        const nv = Array.from(el.children).find((k) => /^nv/.test(k.localName));
        const phEl = path(nv, 'nvPr', 'ph');
        // Placeholders on the master and layout are only frames for the slide's content, not drawn themselves.
        if (phEl && level !== 'slide') continue;
        const phType = phEl ? (attr(phEl, 'type') ?? 'body') : null;
        const phIdx = phEl ? attr(phEl, 'idx') : null;
        const fromLayout = phEl ? findPlaceholder(layoutPh, phType!, phIdx) : undefined;
        const fromMaster = phEl ? findPlaceholder(masterPh, fromLayout?.type ?? phType!, null) : undefined;
        if (phEl && (phType === 'sldNum' || phType === 'dt' || phType === 'ftr') && !kid(el, 'txBody')) continue;

        const spPr = kid(el, 'spPr') ?? kid(el, 'grpSpPr');
        const own = xfrmOf(spPr) ?? (name === 'graphicFrame' ? xfrmOf(el) : null);
        const inherited = own ?? xfrmOf(kid(fromLayout?.sp, 'spPr')) ?? xfrmOf(kid(fromMaster?.sp, 'spPr'));

        if (name === 'grpSp') {
          const g = xfrmOf(kid(el, 'grpSpPr'));
          if (!g) {
            readTree(el, p, level, frame);
            continue;
          }
          const chOff = { x: num(g.chOff, 'x', 0) / EMU, y: num(g.chOff, 'y', 0) / EMU };
          const chExt = { w: num(g.chExt, 'cx', 0) / EMU || g.w, h: num(g.chExt, 'cy', 0) / EMU || g.h };
          const sx = chExt.w ? g.w / chExt.w : 1;
          const sy = chExt.h ? g.h / chExt.h : 1;
          const outer = frame.map(g.x, g.y, g.w, g.h);
          const gcx = outer.x + outer.w / 2;
          const gcy = outer.y + outer.h / 2;
          const rad = (g.rot * Math.PI) / 180;
          const inner: Frame = {
            map: (x, y, w, h) => {
              const local = frame.map(g.x + (x - chOff.x) * sx, g.y + (y - chOff.y) * sy, w * sx, h * sy);
              if (!g.rot && !g.flipH && !g.flipV) return local;
              // A turned or flipped group moves each child's centre around the group's centre.
              let cx = local.x + local.w / 2 - gcx;
              let cy = local.y + local.h / 2 - gcy;
              if (g.flipH) cx = -cx;
              if (g.flipV) cy = -cy;
              const rx = cx * Math.cos(rad) - cy * Math.sin(rad);
              const ry = cx * Math.sin(rad) + cy * Math.cos(rad);
              return { x: gcx + rx - local.w / 2, y: gcy + ry - local.h / 2, w: local.w, h: local.h };
            },
            rot: frame.rot + g.rot,
            flipH: frame.flipH !== g.flipH,
            flipV: frame.flipV !== g.flipV,
          };
          readTree(el, p, level, inner);
          continue;
        }
        if (!inherited) continue;
        const box = frame.map(inherited.x, inherited.y, inherited.w, inherited.h);
        const base = {
          ...box,
          rot: frame.rot + inherited.rot,
          flipH: frame.flipH !== inherited.flipH,
          flipV: frame.flipV !== inherited.flipV,
        };

        if (name === 'pic') {
          const blipFill = kid(el, 'blipFill');
          const img = blipImage(ctx, kid(blipFill, 'blip'), p.rels);
          if (!img) {
            if (kid(blipFill, 'blip')) warnings.add('pictures in formats other than PNG and JPEG');
            continue;
          }
          const src = kid(blipFill, 'srcRect');
          shapes.push({
            kind: 'picture',
            ...base,
            geometry: readGeometry(spPr),
            fill: null,
            outline: readOutline(ctx, kid(spPr, 'ln')) ?? null,
            picture: { ...img, crop: { l: num(src, 'l', 0) / 100000, t: num(src, 't', 0) / 100000, r: num(src, 'r', 0) / 100000, b: num(src, 'b', 0) / 100000 } },
          });
          continue;
        }
        if (name === 'graphicFrame') {
          const data = path(el, 'graphic', 'graphicData');
          const tbl = kid(data, 'tbl');
          if (tbl) {
            shapes.push({ kind: 'table', ...base, geometry: { preset: 'rect', adjust: {} }, fill: null, outline: null, table: readTable(ctx, tbl, p, styleFor(null), files) });
            continue;
          }
          const uri = attr(data, 'uri') ?? '';
          if (uri.includes('chart')) warnings.add('charts');
          else if (uri.includes('diagram')) warnings.add('SmartArt graphics');
          else warnings.add('embedded objects');
          continue;
        }
        if (name !== 'sp' && name !== 'cxnSp') continue;

        const refs = styleRefs(ctx, el, p.rels);
        const chainSpPr = [kid(fromMaster?.sp, 'spPr'), kid(fromLayout?.sp, 'spPr'), spPr];
        let fill: Paint | undefined;
        let outline: Outline | null | undefined;
        for (const s of chainSpPr) {
          const f = readFill(ctx, s, p.rels);
          if (f !== undefined) fill = f;
          const o = readOutline(ctx, kid(s, 'ln'));
          if (o !== undefined) outline = o;
        }
        if (fill === undefined) fill = refs.fill ?? null;
        if (outline === undefined) outline = refs.outline ?? null;

        const levelChains: (El | undefined)[][] = Array.from({ length: 9 }, (_, i) => {
          const master = styleFor(phType);
          const chain: (El | undefined)[] = [];
          if (!phType) chain.push(levelsOf(defaultTextStyle)[i]);
          chain.push(master[i]);
          chain.push(levelsOf(path(fromMaster?.sp, 'txBody', 'lstStyle'))[i]);
          chain.push(levelsOf(path(fromLayout?.sp, 'txBody', 'lstStyle'))[i]);
          return chain;
        });
        const text = readTextBody(ctx, kid(el, 'txBody'), {
          levels: levelChains,
          bodyPr: [path(fromMaster?.sp, 'txBody', 'bodyPr'), path(fromLayout?.sp, 'txBody', 'bodyPr')].filter(Boolean) as El[],
          fontColor: refs.fontColor,
        });
        const geometry = readGeometry(spPr);
        if (name === 'cxnSp' && !geometry.paths && geometry.preset === 'rect') geometry.preset = 'line';
        shapes.push({ kind: 'shape', ...base, geometry, fill, outline, text });
      }
    };

    const showMaster = (doc: Document) => attr(doc.documentElement, 'showMasterSp') !== '0';
    if (showMaster(slide.doc) && showMaster(layout.doc)) readTree(spTree(master.doc), master, 'master', IDENTITY);
    if (showMaster(slide.doc)) readTree(spTree(layout.doc), layout, 'layout', IDENTITY);
    readTree(spTree(slide.doc), slide, 'slide', IDENTITY);
    slides.push({ background, shapes });
  }
  if (!slides.length) throw new PptxReadError('no slides');
  return { width, height, slides, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------------------------
// Tables.

/** PowerPoint's built-in table styles that decks reference by id without including them. */
const BUILTIN_STYLES: Record<string, string> = {
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1',
  '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2',
  '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4',
  '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5',
  '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6',
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1',
  '{5940675A-B579-460E-94D1-54222C63F5DA}': 'grid',
  '{2D5ABB26-0587-4C30-8999-92F81FD0307C}': 'none',
};

const builtinCache = new Map<string, El | undefined>();

/**
 * "Medium Style 2" (PowerPoint's default table look) in the given colour: a solid header row with
 * white bold text, banded rows in two tints, and white lines between cells. Unknown ids get the
 * default accent 1 version, which is what most decks use.
 */
function builtinTableStyle(id: string | undefined): El | undefined {
  const key = BUILTIN_STYLES[id ?? ''] ?? 'accent1';
  if (builtinCache.has(key)) return builtinCache.get(key);
  const a = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const line = (w: number, color: string) => `<a:ln w="${w}"><a:solidFill>${color}</a:solidFill></a:ln>`;
  let xml: string;
  if (key === 'none') xml = `<a:tblStyle ${a}/>`;
  else if (key === 'grid') {
    const black = line(12700, '<a:schemeClr val="tx1"/>');
    xml = `<a:tblStyle ${a}><a:wholeTbl><a:tcStyle><a:tcBdr><a:left>${black}</a:left><a:right>${black}</a:right><a:top>${black}</a:top><a:bottom>${black}</a:bottom><a:insideH>${black}</a:insideH><a:insideV>${black}</a:insideV></a:tcBdr></a:tcStyle></a:wholeTbl></a:tblStyle>`;
  } else {
    const white = line(12700, '<a:schemeClr val="lt1"/>');
    const thick = line(38100, '<a:schemeClr val="lt1"/>');
    const solid = `<a:fill><a:solidFill><a:schemeClr val="${key}"/></a:solidFill></a:fill>`;
    const tinted = (t: number) => `<a:fill><a:solidFill><a:schemeClr val="${key}"><a:tint val="${t}"/></a:schemeClr></a:solidFill></a:fill>`;
    const strong = `<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle>`;
    xml = `<a:tblStyle ${a}><a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:left>${white}</a:left><a:right>${white}</a:right><a:top>${white}</a:top><a:bottom>${white}</a:bottom><a:insideH>${white}</a:insideH><a:insideV>${white}</a:insideV></a:tcBdr>${tinted(20000)}</a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle>${tinted(40000)}</a:tcStyle></a:band1H><a:band1V><a:tcStyle>${tinted(40000)}</a:tcStyle></a:band1V><a:lastCol>${strong}<a:tcStyle>${solid}</a:tcStyle></a:lastCol><a:firstCol>${strong}<a:tcStyle>${solid}</a:tcStyle></a:firstCol><a:lastRow>${strong}<a:tcStyle><a:tcBdr><a:top>${thick}</a:top></a:tcBdr>${solid}</a:tcStyle></a:lastRow><a:firstRow>${strong}<a:tcStyle><a:tcBdr><a:bottom>${thick}</a:bottom></a:tcBdr>${solid}</a:tcStyle></a:firstRow></a:tblStyle>`;
  }
  const el = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  builtinCache.set(key, el);
  return el;
}

function readTable(ctx: Context, tbl: El, p: Part, other: (El | undefined)[], files: Files): TableM {
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(c, 'w', 0) / EMU);
  const tblPr = kid(tbl, 'tblPr');
  const flag = (name: string) => attr(tblPr, name) === '1';
  const styleId = kid(tblPr, 'tableStyleId')?.textContent?.trim();
  // Table styles used by the deck are written into tableStyles.xml by PowerPoint.
  const stylesDoc = parse(files, 'ppt/tableStyles.xml');
  const style = stylesDoc
    ? (Array.from(stylesDoc.getElementsByTagNameNS('*', 'tblStyle')).find((s) => s.getAttribute('styleId') === styleId) as El | undefined)
    : undefined;
  // A table without a style id has no style; an id the file does not define is a built-in one.
  const styleEl = styleId ? (style ?? builtinTableStyle(styleId)) : undefined;
  const part = (name: string) => kid(styleEl, name);
  const partFill = (name: string): Paint | undefined => readFill(ctx, path(part(name), 'tcStyle', 'fill'), p.rels);
  const partText = (name: string) => {
    const tx = kid(part(name), 'tcTxStyle');
    return tx ? { bold: attr(tx, 'b') === 'on', color: ctx.color(tx)?.color } : undefined;
  };
  const partBorder = (name: string, edge: string): Outline | undefined => readOutline(ctx, path(part(name), 'tcStyle', 'tcBdr', edge, 'ln')) ?? undefined;

  const rowsEl = kids(tbl, 'tr');
  const rows = rowsEl.map((tr, r) => {
    const isFirst = flag('firstRow') && r === 0;
    const isLast = flag('lastRow') && r === rowsEl.length - 1;
    const band = flag('bandRow') && !isFirst ? ((r - (flag('firstRow') ? 1 : 0)) % 2 === 0 ? 'band1H' : 'band2H') : null;
    const cells = kids(tr, 'tc').map((tc, c) => {
      const isFirstCol = flag('firstCol') && c === 0;
      const layers = ['wholeTbl', band, isFirstCol ? 'firstCol' : null, isLast ? 'lastRow' : null, isFirst ? 'firstRow' : null].filter(Boolean) as string[];
      let fill: Paint | undefined;
      let txt: { bold: boolean; color?: string } | undefined;
      for (const layer of layers) {
        const f = partFill(layer);
        if (f !== undefined) fill = f;
        txt = partText(layer) ?? txt;
      }
      const tcPr = kid(tc, 'tcPr');
      const own = readFill(ctx, tcPr, p.rels);
      if (own !== undefined) fill = own;
      const border = (edge: 'L' | 'R' | 'T' | 'B', name: string) => {
        const o = readOutline(ctx, kid(tcPr, `ln${edge}`));
        if (o !== undefined) return o ?? undefined;
        for (const layer of [...layers].reverse()) {
          const b = partBorder(layer, name) ?? (edge === 'L' || edge === 'R' ? partBorder(layer, 'insideV') : partBorder(layer, 'insideH'));
          if (b) return b;
        }
        return undefined;
      };
      const levels = Array.from({ length: 9 }, (_, i) => [other[i]]);
      const text = readTextBody(ctx, kid(tc, 'txBody'), { levels, bodyPr: [], fontColor: txt?.color }) ?? readTextBody(ctx, document.createElementNS(null, 'txBody'), { levels, bodyPr: [] })!;
      if (txt?.bold) text.paragraphs.forEach((pp) => pp.runs.forEach((run) => (run.bold = true)));
      text.inset = {
        l: num(tcPr, 'marL', 91440) / EMU,
        r: num(tcPr, 'marR', 91440) / EMU,
        t: num(tcPr, 'marT', 45720) / EMU,
        b: num(tcPr, 'marB', 45720) / EMU,
      };
      text.anchor = (attr(tcPr, 'anchor') as TextBody['anchor']) ?? 't';
      return {
        text,
        fill: fill ?? null,
        borders: { l: border('L', 'left'), r: border('R', 'right'), t: border('T', 'top'), b: border('B', 'bottom') },
        colSpan: num(tc, 'gridSpan', 1),
        rowSpan: num(tc, 'rowSpan', 1),
        merged: attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1',
      };
    });
    return { height: num(tr, 'h', 0) / EMU, cells };
  });
  return { cols, rows };
}
