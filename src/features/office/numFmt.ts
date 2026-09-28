/**
 * Excel number formats: turns a cell's value and its format code ("#,##0.00", "d-mmm-yy",
 * "0.0%", "[Red](#,##0)", "$#,##0.00_);($#,##0.00)", "@"...) into the text Excel shows. Covers
 * sections, conditions, colours, currency and locale tags, thousands separators and scaling,
 * percentages, scientific notation, fractions, text placeholders, dates, times and elapsed time.
 */

export interface Formatted {
  text: string;
  /** A colour named in the format, such as [Red]. */
  color?: string;
}

/** Excel's built-in formats, by id. 14 (short date) follows the reader's locale in Excel; see below. */
const BUILTIN: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};

/** The short date Excel shows for format 14: month first in the US, day first almost everywhere else. */
function shortDate(): string {
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return /^en-(US|PH)|^(fil)/i.test(locale) ? 'm/d/yyyy' : /^(zh|ja|ko|hu|lt|sv|fr-CA)/i.test(locale) ? 'yyyy-mm-dd' : 'dd/mm/yyyy';
}

export function builtinFormat(id: number): string {
  if (id === 14) return shortDate();
  // Ids 27–36 and 50–58 are East Asian date formats; they show as dates.
  if ((id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return shortDate();
  return BUILTIN[id] ?? 'General';
}

const COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#00a000',
  blue: '#0000ff',
  yellow: '#c0a000',
  magenta: '#ff00ff',
  cyan: '#00a0a0',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Splits a format into its sections at semicolons outside quotes, brackets and escapes. */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '\\' && !quoted) {
      cur += c + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '[') bracket = true;
    else if (!quoted && c === ']') bracket = false;
    if (c === ';' && !quoted && !bracket) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

interface Section {
  body: string;
  color?: string;
  condition?: { op: string; value: number };
  /** [h], [m] or [s]: elapsed time rather than time of day. */
  elapsed: boolean;
}

/** Pulls the bracketed parts ([Red], [>=100], [$€-407], [h]) out of a section. */
function parseSection(raw: string): Section {
  let body = '';
  let color: string | undefined;
  let condition: Section['condition'];
  let elapsed = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      const end = raw.indexOf('"', i + 1);
      body += raw.slice(i, end < 0 ? raw.length : end + 1);
      i = end < 0 ? raw.length : end;
      continue;
    }
    if (c === '\\') {
      body += raw.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === '[') {
      const end = raw.indexOf(']', i);
      const inner = raw.slice(i + 1, end < 0 ? raw.length : end);
      i = end < 0 ? raw.length : end;
      const lower = inner.toLowerCase();
      if (COLORS[lower]) color = COLORS[lower];
      else if (/^color\s*\d+$/.test(lower)) color = undefined;
      else if (/^(<=|>=|<>|<|>|=)\s*-?[\d.]+$/.test(inner)) {
        const m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner)!;
        condition = { op: m[1], value: parseFloat(m[2]) };
      } else if (/^h+$|^m+$|^s+$/.test(lower)) {
        elapsed = true;
        body += `[${lower}]`;
      } else if (inner.startsWith('$')) {
        // Currency and locale: [$€-407] shows "€"; [$-409] only sets the locale.
        const symbol = inner.slice(1).split('-')[0];
        if (symbol) body += `"${symbol}"`;
      }
      continue;
    }
    body += c;
  }
  return { body, color, condition, elapsed };
}

function test(cond: NonNullable<Section['condition']>, v: number): boolean {
  switch (cond.op) {
    case '<':
      return v < cond.value;
    case '<=':
      return v <= cond.value;
    case '>':
      return v > cond.value;
    case '>=':
      return v >= cond.value;
    case '=':
      return v === cond.value;
    default:
      return v !== cond.value;
  }
}

/** Excel's General format: up to 11 significant digits, switching to scientific notation for extremes. */
export function general(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e11 || abs < 1e-9) {
    const [m, e] = v.toExponential(5).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  const digits = Math.max(0, 10 - Math.floor(Math.log10(abs)));
  const fixed = v.toFixed(Math.min(20, digits));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

const isDateFormat = (body: string) => {
  const stripped = body.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? 'h' : ''));
  return /[dyhs]|(^|[^a-z])m|AM\/PM|A\/P/i.test(stripped) && !/[0#?]/.test(stripped.replace(/\.0+/g, ''));
};

/** A date serial number as a calendar date and time (UTC fields). */
export function serialToDate(serial: number, date1904: boolean): Date {
  let days = serial;
  if (date1904) days += 1462;
  // Excel counts 29 February 1900, which did not exist; serials before it are one day off.
  else if (days < 60) days += 1;
  const ms = Math.round((days - 25569) * 86400000);
  return new Date(ms);
}

function formatDate(v: number, body: string, date1904: boolean): string {
  const d = serialToDate(v, date1904);
  // Rounded to the shown precision: whole seconds unless the format shows fractions.
  const fraction = /s\.(0+)/i.exec(body)?.[1]?.length ?? 0;
  const unit = 1000 / 10 ** fraction;
  const t = new Date(Math.round(d.getTime() / unit) * unit);
  const Y = t.getUTCFullYear();
  const M = t.getUTCMonth();
  const D = t.getUTCDate();
  const W = t.getUTCDay();
  let h = t.getUTCHours();
  const mi = t.getUTCMinutes();
  const s = t.getUTCSeconds();
  const ms = t.getUTCMilliseconds();
  const ampm = /AM\/PM|A\/P/i.test(body);
  const totalSeconds = Math.round(v * 86400 * 10 ** fraction) / 10 ** fraction;

  // Tokenize so that "m" can be read as minutes after an hour or before seconds.
  const tokens: { t: string; v: string }[] = [];
  for (let i = 0; i < body.length; ) {
    const rest = body.slice(i);
    let m: RegExpExecArray | null;
    if (rest[0] === '"') {
      const end = body.indexOf('"', i + 1);
      tokens.push({ t: 'lit', v: body.slice(i + 1, end < 0 ? body.length : end) });
      i = end < 0 ? body.length : end + 1;
    } else if (rest[0] === '\\') {
      tokens.push({ t: 'lit', v: rest[1] ?? '' });
      i += 2;
    } else if ((m = /^\[(h+|m+|s+)\]/i.exec(rest))) {
      tokens.push({ t: 'elapsed', v: m[1].toLowerCase() });
      i += m[0].length;
    } else if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) {
      tokens.push({ t: 'ampm', v: m[1] });
      i += m[0].length;
    } else if ((m = /^(y+|m+|d+|h+|s+)/i.exec(rest))) {
      tokens.push({ t: m[1][0].toLowerCase(), v: m[1].toLowerCase() });
      i += m[0].length;
    } else if ((m = /^\.0+/.exec(rest)) && tokens.some((tk) => tk.t === 's' || tk.t === 'elapsed')) {
      tokens.push({ t: 'frac', v: m[0] });
      i += m[0].length;
    } else if (rest[0] === '_') {
      tokens.push({ t: 'lit', v: ' ' });
      i += 2;
    } else if (rest[0] === '*') {
      i += 2;
    } else {
      tokens.push({ t: 'lit', v: rest[0] });
      i++;
    }
  }
  tokens.forEach((tk, i) => {
    if (tk.t !== 'm' || tk.v.length > 2) return;
    const prev = tokens.slice(0, i).reverse().find((x) => x.t !== 'lit');
    const next = tokens.slice(i + 1).find((x) => x.t !== 'lit');
    if (prev?.t === 'h' || prev?.t === 'elapsed' || next?.t === 's') tk.t = 'min';
  });
  if (ampm) h = h % 12 || 12;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return tokens
    .map((tk) => {
      switch (tk.t) {
        case 'lit':
          return tk.v;
        case 'y':
          return tk.v.length <= 2 ? pad(Y % 100, 2) : String(Y);
        case 'm':
          return tk.v.length === 1 ? String(M + 1) : tk.v.length === 2 ? pad(M + 1, 2) : tk.v.length === 3 ? MONTHS[M].slice(0, 3) : tk.v.length === 5 ? MONTHS[M][0] : MONTHS[M];
        case 'min':
          return tk.v.length === 1 ? String(mi) : pad(mi, 2);
        case 'd':
          return tk.v.length === 1 ? String(D) : tk.v.length === 2 ? pad(D, 2) : tk.v.length === 3 ? DAYS[W].slice(0, 3) : DAYS[W];
        case 'h':
          return tk.v.length === 1 ? String(h) : pad(h, 2);
        case 's':
          return tk.v.length === 1 ? String(s) : pad(s, 2);
        case 'frac':
          return `.${pad(Math.floor(ms / 10 ** (3 - (tk.v.length - 1))), tk.v.length - 1)}`;
        case 'ampm': {
          const pm = t.getUTCHours() >= 12;
          return tk.v.length === 3 ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM';
        }
        case 'elapsed': {
          const unit = tk.v[0];
          const total = unit === 'h' ? Math.floor(totalSeconds / 3600) : unit === 'm' ? Math.floor(totalSeconds / 60) : Math.floor(totalSeconds);
          return pad(total, tk.v.length);
        }
        default:
          return '';
      }
    })
    .join('');
}

/** Greatest common divisor, for fractions. */
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The closest fraction with a denominator of at most `maxDen`. */
function fraction(x: number, maxDen: number): [number, number] {
  let best: [number, number] = [0, 1];
  let err = Infinity;
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(x * den);
    const e = Math.abs(x - num / den);
    if (e < err - 1e-12) {
      err = e;
      best = [num, den];
    }
  }
  const g = gcd(best[0], best[1]) || 1;
  return [best[0] / g, best[1] / g];
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats a number with a number (not date) section body. `abs` tells whether the sign is already handled. */
function formatNumber(v: number, body: string): string {
  // Literal text is kept aside so its characters are not read as placeholders.
  const parts: { lit: boolean; v: string }[] = [];
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === '"') {
      const end = body.indexOf('"', i + 1);
      parts.push({ lit: true, v: body.slice(i + 1, end < 0 ? body.length : end) });
      i = end < 0 ? body.length : end + 1;
    } else if (c === '\\') {
      parts.push({ lit: true, v: body[i + 1] ?? '' });
      i += 2;
    } else if (c === '_') {
      // Space the width of the next character: a plain space in a PDF.
      parts.push({ lit: true, v: ' ' });
      i += 2;
    } else if (c === '*') {
      // Repeat-to-fill: nothing to fill in a fixed cell drawing.
      i += 2;
    } else {
      const last = parts[parts.length - 1];
      if (last && !last.lit) last.v += c;
      else parts.push({ lit: false, v: c });
      i++;
    }
  }
  const code = parts.filter((p) => !p.lit).map((p) => p.v).join('');
  if (!/[0#?]/.test(code)) {
    // No digits at all ("-" for zero, or just text): the literals are the result.
    return parts.map((p) => (p.lit ? p.v : p.v.replace(/[%]/g, ''))).join('');
  }

  let value = v;
  const percent = (code.match(/%/g) ?? []).length;
  value *= 100 ** percent;

  // Scientific notation.
  const sci = /[eE]([+-])([0#?]+)/.exec(code);
  if (sci) {
    const mantissaPattern = code.slice(0, sci.index);
    const [intPat, decPat = ''] = mantissaPattern.split('.');
    const decimals = (decPat.match(/[0#?]/g) ?? []).length;
    const intDigits = Math.max(1, (intPat.match(/[0#?]/g) ?? []).length);
    // "##0.0E+0" groups exponents in steps of the integer digits (engineering notation).
    const step = intPat.includes('#') ? intDigits : 1;
    let exp = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
    exp = Math.floor(exp / step) * step;
    let mant = value / 10 ** exp;
    if (Number(Math.abs(mant).toFixed(decimals)) >= 10 ** step) {
      exp += step;
      mant = value / 10 ** exp;
    }
    const mantText = Math.abs(mant).toFixed(decimals);
    const expText = String(Math.abs(exp)).padStart(sci[2].length, '0');
    const sign = exp < 0 ? '-' : sci[1] === '+' ? '+' : '';
    const numberText = `${mantText}E${sign}${expText}`;
    return assemble(parts, numberText);
  }

  // Fractions: "# ?/?" or "?/8".
  const frac = /([0#?]*)\s*([0#?]+)\/([0#?]+|\d+)/.exec(code);
  if (frac) {
    const whole = frac[1] ? Math.trunc(value) : 0;
    const rest = Math.abs(value - whole);
    const fixedDen = /^\d+$/.test(frac[3]) ? Number(frac[3]) : 0;
    const [num, den] = fixedDen ? [Math.round(rest * fixedDen), fixedDen] : fraction(rest, 10 ** frac[3].length - 1);
    let text: string;
    if (num === 0) text = frac[1] ? String(Math.abs(whole)) : `0/${den}`;
    else if (num === den && !fixedDen) text = String(Math.abs(whole) + 1);
    else text = `${frac[1] && whole ? `${Math.abs(whole)} ` : ''}${num}/${den}`;
    // A fixed denominator ("?/8") is part of the number, not text after it.
    return assemble(parts, text, /[0#?\d]/);
  }

  // Scaling: each comma right after the last digit placeholder divides by 1,000.
  const scale = /[0#?](,+)(?![0#?])/.exec(code);
  if (scale) value /= 1000 ** scale[1].length;

  // Literal characters between digit placeholders ("000-00-0000", or Indian "##\,##\,##0"):
  // Excel fills the placeholders with digits from the right and keeps the characters in place.
  const tokens: ({ ph: string } | { lit: string } | { dot: true })[] = [];
  for (const p of parts) {
    if (p.lit) {
      tokens.push({ lit: p.v });
      continue;
    }
    for (let k = 0; k < p.v.length; k++) {
      const ch = p.v[k];
      if (ch === '0' || ch === '#' || ch === '?') tokens.push({ ph: ch });
      else if (ch === '.') tokens.push({ dot: true });
      else if (ch === ',') continue;
      else tokens.push({ lit: ch });
    }
  }
  const dotAt = tokens.findIndex((t) => 'dot' in t);
  const intTokens = dotAt < 0 ? tokens : tokens.slice(0, dotAt);
  const firstPh = intTokens.findIndex((t) => 'ph' in t);
  let lastPh = -1;
  intTokens.forEach((t, k) => {
    if ('ph' in t) lastPh = k;
  });
  if (firstPh >= 0 && intTokens.slice(firstPh, lastPh).some((t) => 'lit' in t && t.lit !== ' ')) {
    const decTokens = dotAt < 0 ? [] : tokens.slice(dotAt + 1);
    const places = decTokens.filter((t) => 'ph' in t).length;
    const [intDigits, decDigits = ''] = Math.abs(value).toFixed(places).split('.');
    const digits = intDigits === '0' ? '' : intDigits;
    const out: string[] = intTokens.map(() => '');
    let d = digits.length - 1;
    for (let k = intTokens.length - 1; k >= 0; k--) {
      const t = intTokens[k];
      if ('ph' in t) out[k] = d >= 0 ? digits[d--] : t.ph === '0' ? '0' : t.ph === '?' ? ' ' : '';
      else out[k] = 'lit' in t ? t.lit : '';
    }
    // Digits beyond the placeholders go in front of the first one.
    if (d >= 0) out[firstPh] = digits.slice(0, d + 1) + out[firstPh];
    let dec = '';
    let di = 0;
    for (const t of decTokens) {
      if ('ph' in t) dec += decDigits[di++] ?? '';
      else if ('lit' in t) dec += t.lit;
    }
    return out.join('') + (dotAt >= 0 ? `.${dec}` : '');
  }
  const [intPat, decPat = ''] = code.split('.');
  const thousands = /[0#?],[0#?]/.test(intPat);
  const decimals = (decPat.match(/[0#?]/g) ?? []).length;
  const optional = (decPat.match(/[#?]/g) ?? []).length;
  let fixed = Math.abs(value).toFixed(decimals);
  let [int, dec = ''] = fixed.split('.');
  // Optional decimal places (#) are dropped when zero.
  if (optional) {
    let keep = dec.length;
    while (keep > decimals - optional && dec[keep - 1] === '0') keep--;
    dec = dec.slice(0, keep);
  }
  const minInt = (intPat.match(/0/g) ?? []).length;
  if (int === '0' && minInt === 0) int = '';
  int = int.padStart(minInt, '0');
  if (thousands) int = groupThousands(int);
  fixed = dec || decPat.length ? `${int}${code.includes('.') && (dec || /0/.test(decPat)) ? '.' : ''}${dec}` : int;
  if (!fixed) fixed = '0';
  return assemble(parts, fixed);
}

/** Puts a formatted number in place of the placeholders, keeping the literals around it. */
function assemble(parts: { lit: boolean; v: string }[], numberText: string, placeholder = /[0#?]/): string {
  let placed = false;
  return parts
    .map((p) => {
      if (p.lit) return p.v;
      // Pieces without placeholders are signs and brackets, such as "%" or "(".
      if (!/[0#?]/.test(p.v)) return p.v.replace(/,/g, '');
      const first = p.v.search(/[0#?]/);
      let last = p.v.length - 1;
      while (last >= 0 && !placeholder.test(p.v[last])) last--;
      const before = p.v.slice(0, first);
      const after = p.v.slice(last + 1).replace(/^,+/, '');
      if (placed) return before + after;
      placed = true;
      return before + numberText + after;
    })
    .join('');
}

/** Formats a cell value with its number format, as Excel displays it. */
export function formatValue(value: number | string | boolean, format: string, date1904 = false): Formatted {
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  const secs = sections(format || 'General').map(parseSection);
  if (typeof value === 'string') {
    // Text uses the fourth section, or a single section with "@".
    const textSection = secs[3] ?? (secs.length === 1 && secs[0].body.includes('@') ? secs[0] : null);
    if (!textSection) return { text: value };
    return { text: textSection.body.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '').replace(/@/g, value), color: textSection.color };
  }
  if (!Number.isFinite(value)) return { text: '#NUM!' };

  let section: Section;
  let v = value;
  const conditional = secs.some((s) => s.condition);
  if (conditional) {
    section = secs.find((s, i) => i < 2 && s.condition && test(s.condition, value)) ?? secs[secs.length > 2 ? 2 : secs.findIndex((s) => !s.condition) ?? 0] ?? secs[0];
    if (secs.indexOf(section) === 1 && value < 0) v = Math.abs(value);
  } else if (secs.length >= 3 && value === 0) section = secs[2];
  else if (secs.length >= 2 && value < 0) {
    section = secs[1];
    v = Math.abs(value);
  } else section = secs[0];

  const body = section.body;
  if (/^general$/i.test(body.trim()) || !body.trim()) {
    return { text: general(v), color: section.color };
  }
  if (/general/i.test(body)) {
    return { text: body.replace(/general/i, general(v)).replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1'), color: section.color };
  }
  if (isDateFormat(body) || section.elapsed) {
    if (value < 0 && !section.elapsed) return { text: '#'.repeat(8) };
    return { text: formatDate(v, body, date1904), color: section.color };
  }
  const negative = v < 0;
  const text = formatNumber(Math.abs(v), body.replace(/@/g, ''));
  return { text: negative && !/^-/.test(text) ? `-${text}` : text, color: section.color };
}
