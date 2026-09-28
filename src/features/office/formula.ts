/**
 * A small spreadsheet formula evaluator. Excel saves each formula's last result with the file, so
 * this is only used for workbooks written by other programs (exports from web apps and scripts)
 * that store formulas without results. It covers arithmetic, comparisons, text joining, cell
 * references and ranges on the same sheet, and the functions such exports typically use.
 * Anything it does not know gives null, and the cell is left blank rather than showing a guess.
 */

export type Value = number | string | boolean | null;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; row: number; col: number }
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'fn'; name: string }
  | { t: 'op'; v: string }
  | { t: '('; }
  | { t: ')'; }
  | { t: ','; };

class Unsupported extends Error {}

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (/^\s/.test(rest)) {
      i++;
    } else if ((m = /^"((?:[^"]|"")*)"/.exec(rest))) {
      out.push({ t: 'str', v: m[1].replace(/""/g, '"') });
      i += m[0].length;
    } else if ((m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest))) {
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if ((m = /^(TRUE|FALSE)\b/i.exec(rest))) {
      out.push({ t: 'bool', v: m[1].toUpperCase() === 'TRUE' });
      i += m[0].length;
    } else if ((m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest))) {
      out.push({ t: 'fn', name: m[1].toUpperCase().replace(/^_XLFN\./, '') });
      out.push({ t: '(' });
      i += m[0].length;
    } else if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)/.exec(rest))) {
      const [c1, r1, c2, r2] = [colIndex(m[1]), Number(m[2]) - 1, colIndex(m[3]), Number(m[4]) - 1];
      out.push({ t: 'range', r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) });
      i += m[0].length;
    } else if ((m = /^\$?([A-Za-z]{1,3})\$?(\d+)/.exec(rest))) {
      out.push({ t: 'ref', col: colIndex(m[1]), row: Number(m[2]) - 1 });
      i += m[0].length;
    } else if ((m = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(rest))) {
      out.push({ t: 'op', v: m[1] });
      i += m[0].length;
    } else if (rest[0] === '(' || rest[0] === ')' || rest[0] === ',' || rest[0] === ';') {
      out.push(rest[0] === ';' ? { t: ',' } : ({ t: rest[0] } as Token));
      i++;
    } else {
      // Sheet names, names, arrays and other syntax are beyond this evaluator.
      throw new Unsupported(rest[0]);
    }
  }
  return out;
}

type Ranged = { range: Value[] };
type Operand = Value | Ranged;

const isRange = (v: Operand): v is Ranged => typeof v === 'object' && v !== null && 'range' in v;

function num(v: Operand): number {
  if (isRange(v)) return num(v.range[0] ?? null);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Unsupported('#VALUE!');
  return n;
}

const str = (v: Operand): string => {
  if (isRange(v)) return str(v.range[0] ?? null);
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
};

const flat = (args: Operand[]): Value[] => args.flatMap((a) => (isRange(a) ? a.range : [a]));
const numbers = (args: Operand[]) =>
  args.flatMap((a) => (isRange(a) ? a.range.filter((v): v is number => typeof v === 'number') : [num(a)]));

const round = (n: number, digits: number, mode: 'round' | 'up' | 'down') => {
  const f = 10 ** digits;
  const x = Math.abs(n) * f;
  const r = mode === 'round' ? Math.round(x + 1e-9) : mode === 'up' ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  return (Math.sign(n) * r) / f;
};

const FUNCTIONS: Record<string, (args: Operand[]) => Value> = {
  SUM: (a) => numbers(a).reduce((s, n) => s + n, 0),
  PRODUCT: (a) => numbers(a).reduce((s, n) => s * n, 1),
  AVERAGE: (a) => {
    const n = numbers(a);
    if (!n.length) throw new Unsupported('#DIV/0!');
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MIN: (a) => (numbers(a).length ? Math.min(...numbers(a)) : 0),
  MAX: (a) => (numbers(a).length ? Math.max(...numbers(a)) : 0),
  COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
  ROUND: (a) => round(num(a[0]), num(a[1] ?? 0), 'round'),
  ROUNDUP: (a) => round(num(a[0]), num(a[1] ?? 0), 'up'),
  ROUNDDOWN: (a) => round(num(a[0]), num(a[1] ?? 0), 'down'),
  INT: (a) => Math.floor(num(a[0])),
  ABS: (a) => Math.abs(num(a[0])),
  SQRT: (a) => Math.sqrt(num(a[0])),
  MOD: (a) => {
    const d = num(a[1]);
    if (!d) throw new Unsupported('#DIV/0!');
    const n = num(a[0]);
    return n - d * Math.floor(n / d);
  },
  IF: (a) => (num(a[0]) ? (a[1] === undefined ? true : scalar(a[1])) : a[2] === undefined ? false : scalar(a[2])),
  AND: (a) => flat(a).every((v) => num(v) !== 0),
  OR: (a) => flat(a).some((v) => num(v) !== 0),
  NOT: (a) => !num(a[0]),
  CONCATENATE: (a) => a.map(str).join(''),
  CONCAT: (a) => flat(a).map(str).join(''),
  LEN: (a) => str(a[0]).length,
  UPPER: (a) => str(a[0]).toUpperCase(),
  LOWER: (a) => str(a[0]).toLowerCase(),
  TRIM: (a) => str(a[0]).trim().replace(/ +/g, ' '),
};

const scalar = (v: Operand): Value => (isRange(v) ? (v.range[0] ?? null) : v);

/** Evaluates `formula` (without its leading "="); `cell` reads another cell's value. Null when not supported. */
export function evaluate(formula: string, cell: (row: number, col: number) => Value): Value {
  let tokens: Token[];
  try {
    tokens = tokenize(formula.replace(/^=/, ''));
  } catch {
    return null;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // Precedence, lowest first: comparison, &, + -, * /, ^, unary -, %.
  const compare = (): Operand => {
    let left = concat();
    while (peek()?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      const right = concat();
      const a = scalar(left);
      const b = scalar(right);
      const cmp = typeof a === 'string' || typeof b === 'string' ? str(a).localeCompare(str(b), undefined, { sensitivity: 'accent' }) : num(a) - num(b);
      left = op === '=' ? cmp === 0 : op === '<>' ? cmp !== 0 : op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0;
    }
    return left;
  };
  const concat = (): Operand => {
    let left = additive();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '&') {
      next();
      left = str(left) + str(additive());
    }
    return left;
  };
  const additive = (): Operand => {
    let left = multiplicative();
    while (peek()?.t === 'op' && ['+', '-'].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      const right = multiplicative();
      left = op === '+' ? num(left) + num(right) : num(left) - num(right);
    }
    return left;
  };
  const multiplicative = (): Operand => {
    let left = power();
    while (peek()?.t === 'op' && ['*', '/'].includes((peek() as { v: string }).v)) {
      const op = (next() as { v: string }).v;
      const right = power();
      if (op === '/' && num(right) === 0) throw new Unsupported('#DIV/0!');
      left = op === '*' ? num(left) * num(right) : num(left) / num(right);
    }
    return left;
  };
  const power = (): Operand => {
    let left = unary();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '^') {
      next();
      left = num(left) ** num(unary());
    }
    return left;
  };
  const unary = (): Operand => {
    const t = peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      next();
      const v = num(unary());
      return t.v === '-' ? -v : v;
    }
    let v = primary();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') {
      next();
      v = num(v) / 100;
    }
    return v;
  };
  const primary = (): Operand => {
    const t = next();
    if (!t) throw new Unsupported('end');
    switch (t.t) {
      case 'num':
      case 'str':
      case 'bool':
        return t.v;
      case 'ref':
        return cell(t.row, t.col);
      case 'range': {
        const values: Value[] = [];
        for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) values.push(cell(r, c));
        return { range: values };
      }
      case '(': {
        const v = compare();
        if (next()?.t !== ')') throw new Unsupported(')');
        return v;
      }
      case 'fn': {
        next(); // "("
        const args: Operand[] = [];
        if (peek()?.t !== ')') {
          for (;;) {
            if (t.name === 'IFERROR') {
              // IFERROR catches errors in its first argument only.
              const start = pos;
              try {
                args.push(compare());
              } catch {
                pos = start;
                let depth = 0;
                while (pos < tokens.length && !(depth === 0 && (tokens[pos].t === ',' || tokens[pos].t === ')'))) {
                  if (tokens[pos].t === '(') depth++;
                  if (tokens[pos].t === ')') depth--;
                  pos++;
                }
                args.push({ range: [] });
                (args as unknown as { failed: boolean }).failed = true;
              }
            } else args.push(compare());
            if (peek()?.t === ',') {
              next();
              continue;
            }
            break;
          }
        }
        if (next()?.t !== ')') throw new Unsupported(')');
        if (t.name === 'IFERROR') return (args as unknown as { failed?: boolean }).failed ? scalar(args[1] ?? '') : scalar(args[0]);
        const fn = FUNCTIONS[t.name];
        if (!fn) throw new Unsupported(t.name);
        return fn(args);
      }
      default:
        throw new Unsupported(t.t);
    }
  };

  try {
    const result = scalar(compare());
    if (pos !== tokens.length) return null;
    if (typeof result === 'number' && !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}
