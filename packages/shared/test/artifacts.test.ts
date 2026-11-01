import { describe, expect, it } from 'vitest';
import { columnName, evaluateSheet, parseChartSpec, parseCsv, parseSlides, toCsv } from '../src/index.js';

const values = (grid: string[][]) => evaluateSheet(grid).map((r) => r.map((c) => c.error ?? c.value));

describe('parseChartSpec', () => {
  it('normalizes y to an array', () => {
    const r = parseChartSpec(JSON.stringify({ type: 'bar', data: [{ m: 'Jan', v: 3 }], x: 'm', y: 'v' }));
    expect(r.ok && r.spec.y).toEqual(['v']);
  });
  it('reports invalid JSON and schema errors readably', () => {
    const bad = parseChartSpec('{nope');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/valid JSON/);
    const schema = parseChartSpec(JSON.stringify({ type: 'radar', data: [], x: 'a', y: 'b' }));
    expect(!schema.ok && schema.error).toMatch(/type/);
  });
});

describe('parseSlides', () => {
  it('splits slides, extracts titles, bodies and notes', () => {
    const s = parseSlides('# Intro\n- one\n- **two**\nNote: say hi\n---\n## Next\n\nBody text\n\n---\n\n');
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ title: 'Intro', body: '- one\n- **two**', bullets: ['one', 'two'], notes: 'say hi' });
    expect(s[1]!.title).toBe('Next');
    expect(s[1]!.body).toBe('Body text');
  });
  it('uses the first line as title when there is no heading', () => {
    expect(parseSlides('Hello\nworld')[0]!.title).toBe('Hello');
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, newlines in cells and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",3\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '3'],
    ]);
  });
  it('detects tab and semicolon delimiters and strips BOM', () => {
    expect(parseCsv('\uFEFFa\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips through toCsv', () => {
    const rows = [['name', 'note'], ['A', 'has, comma'], ['B', 'has "quote"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('evaluateSheet', () => {
  it('computes arithmetic, precedence, percent and power', () => {
    expect(values([['=1+2*3', '=(1+2)*3', '=2^3^1', '=50%', '=-2+5']])).toEqual([[7, 9, 8, 0.5, 3]]);
  });
  it('resolves references and ranges with functions', () => {
    const v = values([
      ['Item', 'Qty', 'Price', 'Total'],
      ['A', '2', '3', '=B2*C2'],
      ['B', '4', '5', '=B3*C3'],
      ['', '', 'Sum', '=SUM(D2:D3)'],
      ['', '', 'Avg', '=AVERAGE(D2:D3)'],
      ['', '', 'Max', '=MAX($D$2:D3)'],
      ['', '', 'Count', '=COUNTA(A1:A3)'],
    ]);
    expect(v[1]![3]).toBe(6);
    expect(v[2]![3]).toBe(20);
    expect(v[3]![3]).toBe(26);
    expect(v[4]![3]).toBe(13);
    expect(v[5]![3]).toBe(20);
    expect(v[6]![3]).toBe(3);
  });
  it('supports text, comparison and logic functions', () => {
    expect(values([['="a"&"b"', '=IF(2>1,"yes","no")', '=AND(1,0)', '=OR(1,0)', '=UPPER("x")', '=LEN("abc")', '=ROUND(2.345,2)', '=1<>2', '="A"="a"']])).toEqual([
      ['ab', 'yes', false, true, 'X', 3, 2.35, true, true],
    ]);
  });
  it('returns spreadsheet error codes', () => {
    expect(values([['=1/0', '=NOPE(1)', '="a"+1', '=1+', '=SQRT(-1)', '=AVERAGE(Z1:Z2)']])).toEqual([['#DIV/0!', '#NAME?', '#VALUE!', '#ERROR!', '#NUM!', '#DIV/0!']]);
  });
  it('detects cycles and propagates errors to dependents', () => {
    const v = values([['=B1', '=A1', '=A1+1'], ['=1/0', '=A2*2', '5']]);
    expect(v[0]).toEqual(['#CYCLE!', '#CYCLE!', '#CYCLE!']);
    expect(v[1]).toEqual(['#DIV/0!', '#DIV/0!', 5]);
  });
  it('treats literals as numbers, booleans or text and empty refs as zero', () => {
    expect(values([['3.5', 'true', 'hello', '', '=D1+1']])).toEqual([[3.5, true, 'hello', null, 1]]);
  });
  it('names columns like spreadsheets', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
