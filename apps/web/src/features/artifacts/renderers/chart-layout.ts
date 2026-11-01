import type { ChartSpec } from '@lumen/shared';

/** Categorical slots come from theme tokens in a fixed order — never cycled, never generated. */
export const seriesColor = (i: number) => `var(--lm-chart-${i + 1})`;
export const OTHER_COLOR = 'var(--lm-text-3)';
/** Scatter compares all pairs of series, so only the first three slots are separable enough. */
export const SCATTER_MAX_SERIES = 3;
export const SEGMENTED_MAX_PARTS = 6;

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[,\s$%]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Round, human tick values ("nice numbers") covering [min, max]. Always includes 0 when the domain spans it. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    if (min === 0) return [0, 1];
    [min, max] = min > 0 ? [0, min] : [min, 0];
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Axis ticks: in full under 10,000; compact on an axis that reaches it (one style per axis). */
export function tickFormatter(ticks: number[]): (v: number) => string {
  const maxAbs = Math.max(...ticks.map(Math.abs));
  if (maxAbs >= 10_000) {
    const f = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
    return (v) => f.format(v);
  }
  const decimals = Math.max(0, ...ticks.map((t) => (String(t).split('.')[1] ?? '').length));
  const f = new Intl.NumberFormat(undefined, { maximumFractionDigits: Math.min(decimals, 4) });
  return (v) => f.format(v);
}

export function formatValue(v: number | null): string {
  if (v === null) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2 }).format(v);
}

export interface Series {
  key: string;
  name: string;
  color: string;
  values: (number | null)[];
}

export interface PreparedChart {
  kind: 'bar' | 'line' | 'area' | 'scatter';
  categories: string[];
  /** Numeric x positions (scatter only). */
  xs: (number | null)[];
  series: Series[];
  /** Series dropped because the form can't keep them distinguishable (they stay in the table view). */
  omitted: string[];
  domain: [number, number];
  xDomain: [number, number];
}

export function prepareChart(spec: ChartSpec): PreparedChart {
  const kind = spec.type === 'pie' ? 'bar' : spec.type;
  const max = kind === 'scatter' ? SCATTER_MAX_SERIES : 8;
  const keys = spec.y.slice(0, max);
  const series = keys.map((key, i) => ({ key, name: key, color: seriesColor(i), values: spec.data.map((row) => toNumber(row[key])) }));
  const categories = spec.data.map((row) => String(row[spec.x] ?? ''));
  const xs = spec.data.map((row) => toNumber(row[spec.x]));

  let lo = 0;
  let hi = 0;
  if (spec.stacked && (kind === 'bar' || kind === 'area')) {
    spec.data.forEach((_, i) => {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    });
  } else {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    lo = Math.min(0, ...all);
    hi = Math.max(0, ...all);
    // Scatter y doesn't need a zero baseline: it plots positions, not magnitudes.
    if (kind === 'scatter' && all.length) {
      lo = Math.min(...all);
      hi = Math.max(...all);
    }
  }
  const xVals = xs.filter((v): v is number => v !== null);
  return {
    kind,
    categories,
    xs,
    series,
    omitted: spec.y.slice(max),
    domain: [lo, hi],
    xDomain: xVals.length ? [Math.min(...xVals), Math.max(...xVals)] : [0, 1],
  };
}

export interface Part {
  name: string;
  value: number;
  share: number;
  color: string;
}

/**
 * Part-to-whole ("pie") data. Up to 6 parts render as one segmented bar; past that, the reader needs to
 * compare parts, so they render as ranked bars in a single hue. Negative/empty values are dropped.
 */
export function partToWhole(spec: ChartSpec): { mode: 'segmented' | 'ranked'; parts: Part[]; total: number } {
  const key = spec.y[0]!;
  const rows = spec.data
    .map((r) => ({ name: String(r[spec.x] ?? ''), value: toNumber(r[key]) ?? 0 }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, p) => s + p.value, 0) || 1;
  if (rows.length <= SEGMENTED_MAX_PARTS) {
    return { mode: 'segmented', total, parts: rows.map((p, i) => ({ ...p, share: p.value / total, color: seriesColor(i) })) };
  }
  return { mode: 'ranked', total, parts: rows.map((p) => ({ ...p, share: p.value / total, color: seriesColor(0) })) };
}

/** Show every k-th category label so horizontal labels never collide. */
export function labelStride(count: number, plotWidth: number, longestChars: number): number {
  const labelW = Math.max(24, longestChars * 7 + 12);
  return Math.max(1, Math.ceil((count * labelW) / Math.max(1, plotWidth)));
}

/** Bar with a 4px rounded data-end and a square baseline. Grows up for positive values, down for negative. */
export function barPath(x: number, w: number, yBase: number, yEnd: number): string {
  const h = Math.abs(yEnd - yBase);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return '';
  if (yEnd <= yBase) {
    return `M${x},${yBase}V${yEnd + r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yEnd - r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd - r}V${yBase}Z`;
}

/** Horizontal bar with the rounded end on the right. */
export function hBarPath(xBase: number, xEnd: number, y: number, h: number): string {
  const w = xEnd - xBase;
  const r = Math.min(4, h / 2, w);
  if (w < 0.5) return '';
  return `M${xBase},${y}H${xEnd - r}Q${xEnd},${y} ${xEnd},${y + r}V${y + h - r}Q${xEnd},${y + h} ${xEnd - r},${y + h}H${xBase}Z`;
}

export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}
