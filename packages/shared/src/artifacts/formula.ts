/**
 * A small, safe spreadsheet formula engine for spreadsheet artifacts: no eval, no network, bounded work.
 * Supports cell refs (A1, $B$2), ranges (A1:C3), arithmetic (+ - * / ^ %), text concatenation (&),
 * comparisons, and common functions. Cycles evaluate to #CYCLE!.
 */
export type CellValue = number | string | boolean | null;

export interface SheetCell {
  value: CellValue;
  error: string | null;
  formula: boolean;
}
export type SheetResult = SheetCell[][];

class FormulaError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Value = CellValue | Value[];

export function columnName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type Token = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'name'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError('#ERROR!');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let s = '';
      i++;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (src[i] === '"') break;
        else s += src[i++];
      }
      if (src[i] !== '"') throw new FormulaError('#ERROR!');
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    const ref = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})(?![\w(])/.exec(src.slice(i));
    if (ref) {
      out.push({ t: 'ref', v: `${ref[1]!.toUpperCase()}${ref[2]}` });
      i += ref[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (name) {
      out.push({ t: 'name', v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>(),:%;'.includes(ch)) {
      out.push({ t: 'op', v: ch === ';' ? ',' : ch });
      i++;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  return out;
}

function parseRef(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return [Number(m[2]) - 1, columnIndex(m[1]!)];
}

const num = (v: Value): number => {
  if (Array.isArray(v)) throw new FormulaError('#VALUE!');
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError('#VALUE!');
  return n;
};
const str = (v: Value): string => {
  if (Array.isArray(v)) throw new FormulaError('#VALUE!');
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
};
const flat = (args: Value[]): CellValue[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
const nums = (args: Value[]): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? flat(a).filter((v): v is number => typeof v === 'number') : [num(a)]));

const FUNCTIONS: Record<string, (args: Value[]) => Value> = {
  SUM: (a) => nums(a).reduce((s, n) => s + n, 0),
  PRODUCT: (a) => nums(a).reduce((s, n) => s * n, 1),
  AVERAGE: (a) => {
    const n = nums(a);
    if (!n.length) throw new FormulaError('#DIV/0!');
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MEDIAN: (a) => {
    const n = nums(a).sort((x, y) => x - y);
    if (!n.length) throw new FormulaError('#NUM!');
    const m = Math.floor(n.length / 2);
    return n.length % 2 ? n[m]! : (n[m - 1]! + n[m]!) / 2;
  },
  MIN: (a) => (nums(a).length ? Math.min(...nums(a)) : 0),
  MAX: (a) => (nums(a).length ? Math.max(...nums(a)) : 0),
  COUNT: (a) => nums(a).length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
  ABS: (a) => Math.abs(num(a[0] ?? 0)),
  SQRT: (a) => {
    const n = num(a[0] ?? 0);
    if (n < 0) throw new FormulaError('#NUM!');
    return Math.sqrt(n);
  },
  ROUND: (a) => {
    const f = 10 ** num(a[1] ?? 0);
    return Math.round(num(a[0] ?? 0) * f) / f;
  },
  IF: (a) => (num(a[0] ?? false) ? (a[1] ?? true) : (a[2] ?? false)),
  AND: (a) => flat(a).every((v) => num(v) !== 0),
  OR: (a) => flat(a).some((v) => num(v) !== 0),
  NOT: (a) => !num(a[0] ?? false),
  CONCAT: (a) => flat(a).map(str).join(''),
  CONCATENATE: (a) => flat(a).map(str).join(''),
  LEN: (a) => str(a[0] ?? '').length,
  UPPER: (a) => str(a[0] ?? '').toUpperCase(),
  LOWER: (a) => str(a[0] ?? '').toLowerCase(),
  TRUE: () => true,
  FALSE: () => false,
  PI: () => Math.PI,
};

const MAX_RANGE_CELLS = 100_000;

/** Evaluate a grid of raw cell strings (formulas start with "="). */
export function evaluateSheet(grid: string[][]): SheetResult {
  const cache = new Map<string, SheetCell>();
  const visiting = new Set<string>();

  const raw = (r: number, c: number) => grid[r]?.[c] ?? '';

  const literal = (s: string): CellValue => {
    const t = s.trim();
    if (t === '') return null;
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return Number(t);
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    return s;
  };

  const cellValue = (r: number, c: number): CellValue => {
    const cell = cell_(r, c);
    if (cell.error) throw new FormulaError(cell.error);
    return cell.value;
  };

  function cell_(r: number, c: number): SheetCell {
    const key = `${r},${c}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const s = raw(r, c);
    if (!s.startsWith('=')) {
      const out = { value: literal(s), error: null, formula: false };
      cache.set(key, out);
      return out;
    }
    if (visiting.has(key)) throw new FormulaError('#CYCLE!');
    visiting.add(key);
    let out: SheetCell;
    try {
      const v = evaluate(s.slice(1));
      if (Array.isArray(v)) throw new FormulaError('#VALUE!');
      if (typeof v === 'number' && !Number.isFinite(v)) throw new FormulaError('#NUM!');
      out = { value: v, error: null, formula: true };
    } catch (e) {
      out = { value: null, error: e instanceof FormulaError ? e.code : '#ERROR!', formula: true };
    } finally {
      visiting.delete(key);
    }
    cache.set(key, out);
    return out;
  }

  function evaluate(src: string): Value {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
    const expect = (v: string) => {
      if (!isOp(v)) throw new FormulaError('#ERROR!');
      p++;
    };

    const comparison = (): Value => {
      let l = concat();
      const COMPARE = ['=', '<>', '<', '>', '<=', '>='];
      for (let t = peek(); t?.t === 'op' && COMPARE.includes(t.v); t = peek()) {
        p++;
        const op = t.v;
        const r = concat();
        const a = typeof l === 'number' || typeof r === 'number' ? num(l) : str(l).toLowerCase();
        const b = typeof l === 'number' || typeof r === 'number' ? num(r) : str(r).toLowerCase();
        l = op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      }
      return l;
    };
    const concat = (): Value => {
      let l = additive();
      while (isOp('&')) {
        p++;
        l = str(l) + str(additive());
      }
      return l;
    };
    const additive = (): Value => {
      let l = term();
      while (isOp('+') || isOp('-')) {
        const op = String(tokens[p++]!.v);
        const r = term();
        l = op === '+' ? num(l) + num(r) : num(l) - num(r);
      }
      return l;
    };
    const term = (): Value => {
      let l = power();
      while (isOp('*') || isOp('/')) {
        const op = String(tokens[p++]!.v);
        const r = power();
        if (op === '/' && num(r) === 0) throw new FormulaError('#DIV/0!');
        l = op === '*' ? num(l) * num(r) : num(l) / num(r);
      }
      return l;
    };
    const power = (): Value => {
      let l = unary();
      while (isOp('^')) {
        p++;
        l = num(l) ** num(unary());
      }
      return l;
    };
    const unary = (): Value => {
      if (isOp('-')) {
        p++;
        return -num(unary());
      }
      if (isOp('+')) {
        p++;
        return num(unary());
      }
      let v = primary();
      while (isOp('%')) {
        p++;
        v = num(v) / 100;
      }
      return v;
    };
    const primary = (): Value => {
      const t = tokens[p++];
      if (!t) throw new FormulaError('#ERROR!');
      if (t.t === 'num' || t.t === 'str') return t.v;
      if (t.t === 'ref') {
        if (isOp(':')) {
          p++;
          const end = tokens[p++];
          if (end?.t !== 'ref') throw new FormulaError('#REF!');
          const [r1, c1] = parseRef(t.v);
          const [r2, c2] = parseRef(end.v);
          const [rs, re] = [Math.min(r1, r2), Math.max(r1, r2)];
          const [cs, ce] = [Math.min(c1, c2), Math.max(c1, c2)];
          if ((re - rs + 1) * (ce - cs + 1) > MAX_RANGE_CELLS) throw new FormulaError('#REF!');
          const out: Value[] = [];
          for (let r = rs; r <= re; r++) for (let c = cs; c <= ce; c++) out.push(cellValue(r, c));
          return out;
        }
        const [r, c] = parseRef(t.v);
        return cellValue(r, c);
      }
      if (t.t === 'name') {
        if (t.v === 'TRUE' && !isOp('(')) return true;
        if (t.v === 'FALSE' && !isOp('(')) return false;
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new FormulaError('#NAME?');
        expect('(');
        const args: Value[] = [];
        if (!isOp(')')) {
          args.push(comparison());
          while (isOp(',')) {
            p++;
            args.push(comparison());
          }
        }
        expect(')');
        return fn(args);
      }
      if (t.v === '(') {
        const v = comparison();
        expect(')');
        return v;
      }
      throw new FormulaError('#ERROR!');
    };

    const v = comparison();
    if (p !== tokens.length) throw new FormulaError('#ERROR!');
    return v;
  }

  return grid.map((row, r) =>
    row.map((_, c) => {
      try {
        return cell_(r, c);
      } catch (e) {
        return { value: null, error: e instanceof FormulaError ? e.code : '#ERROR!', formula: true };
      }
    }),
  );
}
