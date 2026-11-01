import type { Tool } from './registry.js';

/**
 * Safe arithmetic evaluator (recursive descent, no eval). Supports + - * / % ^, parentheses, unary minus,
 * constants (pi, e) and common functions.
 */
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

export function evaluate(expr: string): number {
  if (expr.length > 1000) throw new Error('Expression too long');
  const tokens = expr.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-z_][a-z0-9_]*|\*\*|[-+*/%^(),]/gi);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== expr.replace(/\s/g, '')) throw new Error('Invalid characters in expression');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(`Expected "${t}"`);
  };
  let depth = 0;

  function expression(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  }
  function term(): number {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function power(): number {
    const base = unary();
    if (peek() === '^' || peek() === '**') {
      next();
      return base ** power(); // right-associative
    }
    return base;
  }
  function unary(): number {
    if (peek() === '-') {
      next();
      return -unary();
    }
    if (peek() === '+') {
      next();
      return unary();
    }
    return primary();
  }
  function primary(): number {
    if (++depth > 100) throw new Error('Expression too deeply nested');
    try {
      const t = next();
      if (t === undefined) throw new Error('Unexpected end of expression');
      if (t === '(') {
        const v = expression();
        expect(')');
        return v;
      }
      if (/^\d/.test(t)) return Number(t);
      const name = t.toLowerCase();
      if (name in CONSTS) return CONSTS[name]!;
      const fn = FUNCS[name];
      if (fn) {
        expect('(');
        const args = [expression()];
        while (peek() === ',') {
          next();
          args.push(expression());
        }
        expect(')');
        return fn(...args);
      }
      throw new Error(`Unknown name "${t}"`);
    } finally {
      depth--;
    }
  }

  const result = expression();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

export const calculatorTool: Tool = {
  definition: {
    name: 'calculator',
    description: 'Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, pi, e, sqrt, sin, cos, tan, ln, log, exp, abs, round, floor, ceil, min, max, pow.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. "(12.5 * 4) ^ 2 / sqrt(16)"' } }, required: ['expression'] },
  },
  async run(args) {
    const expr = String(args.expression ?? '');
    const v = evaluate(expr);
    return `${expr} = ${Number.isInteger(v) ? v : Number(v.toPrecision(15))}`;
  },
};

export const datetimeTool: Tool = {
  definition: {
    name: 'current_datetime',
    description: 'Get the current date and time, optionally in a specific IANA time zone (defaults to the user’s time zone).',
    inputSchema: { type: 'object', properties: { timezone: { type: 'string', description: 'IANA zone like "Europe/Paris"' } } },
  },
  async run(args, ctx) {
    const tz = typeof args.timezone === 'string' && args.timezone ? args.timezone : ctx.user.timezone;
    const now = new Date();
    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(now);
    } catch {
      throw new Error(`Unknown time zone "${tz}"`);
    }
    return `${formatted} (${tz}); ISO UTC: ${now.toISOString()}`;
  },
};
