import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { CHART_PALETTES, parseChartSpec, readableOn, type ChartSpec } from '@lumen/shared';
import { Button } from '@lumen/ui';
import { BarChart3, Table2 } from 'lucide-react';
import { barPath, formatValue, hBarPath, labelStride, linePath, niceTicks, partToWhole, prepareChart, tickFormatter } from './chart-layout.js';
import { RenderError } from './RenderError.js';

const HEIGHT = 300;
const SURFACE = 'var(--lm-bg)';
const GRID = 'var(--lm-hover)';
const AXIS = 'var(--lm-border)';

function subscribeMode(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
const useColorMode = () => useSyncExternalStore(subscribeMode, () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'), () => 'light' as const);

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ChartView({ content }: { content: string }) {
  const parsed = useMemo(() => parseChartSpec(content), [content]);
  if (!parsed.ok) return <RenderError title="This chart can’t be drawn">{parsed.error}</RenderError>;
  return <Chart spec={parsed.spec} />;
}

function Chart({ spec }: { spec: ChartSpec }) {
  const [table, setTable] = useState(false);
  return (
    <figure className="m-0 flex flex-col gap-3 bg-bg p-4" data-chart>
      <div className="flex items-start gap-2">
        <figcaption className="min-w-0 flex-1">
          {spec.title ? <h2 className="text-base font-semibold text-fg">{spec.title}</h2> : null}
          {spec.yLabel || spec.xLabel ? <p className="text-xs text-fg-2">{[spec.yLabel, spec.xLabel && `by ${spec.xLabel}`].filter(Boolean).join(' ')}</p> : null}
        </figcaption>
        <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? <BarChart3 size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />} {table ? 'Chart view' : 'Table view'}
        </Button>
      </div>
      {table ? <DataTable spec={spec} /> : spec.type === 'pie' ? <PartToWhole spec={spec} /> : <XYChart spec={spec} />}
    </figure>
  );
}

export function DataTable({ spec }: { spec: ChartSpec }) {
  const cols = [spec.x, ...spec.y];
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr>{cols.map((c) => <th key={c} scope="col" className="border-b border-border px-3 py-1.5 text-left font-medium text-fg">{c}</th>)}</tr>
        </thead>
        <tbody>
          {spec.data.map((row, i) => (
            <tr key={i} className="even:bg-surface/50">
              {cols.map((c, j) => {
                const v = row[c];
                return j === 0 ? <th key={c} scope="row" className="px-3 py-1 text-left font-normal text-fg">{String(v ?? '')}</th> : <td key={c} className="px-3 py-1 text-right tabular-nums text-fg">{typeof v === 'number' ? formatValue(v) : String(v ?? '—')}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ items, mark }: { items: { name: string; color: string }[]; mark: 'rect' | 'line' | 'dot' }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2" aria-label="Legend">
      {items.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden="true">
            {mark === 'line' ? <line x1="0" x2="14" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" /> : mark === 'dot' ? <circle cx="7" cy="5" r="4" fill={s.color} /> : <rect x="2" y="0" width="10" height="10" rx="2" fill={s.color} />}
          </svg>
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = x + 12 + 200 > width ? Math.max(0, x - 12 - 200) : x + 12;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute top-2 z-10 w-[200px] rounded-md border border-border bg-elevated px-3 py-2 text-xs shadow-md" style={{ left }}>
      {children}
    </div>
  );
}

function TooltipRow({ color, name, value, mark = 'line' }: { color: string; name: string; value: string; mark?: 'line' | 'dot' }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <svg width="12" height="8" aria-hidden="true">{mark === 'line' ? <line x1="0" x2="12" y1="4" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" /> : <circle cx="6" cy="4" r="3.5" fill={color} />}</svg>
      <span className="font-semibold tabular-nums text-fg">{value}</span>
      <span className="truncate text-fg-2">{name}</span>
    </div>
  );
}

function XYChart({ spec }: { spec: ChartSpec }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const p = useMemo(() => prepareChart(spec), [spec]);
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();
  if (!p.series.length || !p.categories.length) return <RenderError title="Nothing to plot">The chart has no data rows.</RenderError>;
  const yTicks = niceTicks(p.domain[0], p.domain[1]);
  const fmtY = tickFormatter(yTicks);
  const scatter = p.kind === 'scatter';
  const xTicks = scatter ? niceTicks(p.xDomain[0], p.xDomain[1]) : [];
  const fmtX = scatter ? tickFormatter(xTicks) : (v: number) => String(v);

  // Direct end labels only for lines/areas with ≤4 series, and only if they don't collide.
  const endLabels = (p.kind === 'line' || p.kind === 'area') && p.series.length >= 2 && p.series.length <= 4;
  const left = Math.max(...yTicks.map((t) => fmtY(t).length)) * 7 + 14 + (spec.yLabel ? 16 : 0);
  const right = endLabels ? Math.min(140, Math.max(...p.series.map((s) => s.name.length)) * 7 + 16) : 16;
  const top = 10;
  const bottom = 28 + (spec.xLabel ? 18 : 0);
  const plotW = Math.max(40, width - left - right);
  const plotH = HEIGHT - top - bottom;
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;
  const y = (v: number) => top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const n = p.categories.length;
  const band = plotW / n;
  const cx = (i: number) => left + band * (i + 0.5);
  const xMin = xTicks[0] ?? 0;
  const xMax = xTicks[xTicks.length - 1] ?? 1;
  const sx = (v: number) => left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const baseline = y(Math.max(yMin, Math.min(0, yMax)));

  const points = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : { x: scatter ? (p.xs[i] === null ? NaN : sx(p.xs[i]!)) : cx(i), y: y(v) })).map((pt) => (pt && Number.isFinite(pt.x) ? pt : null));

  let labels: { name: string; y: number; color: string }[] = [];
  if (endLabels) {
    labels = p.series
      .map((s) => {
        const last = [...s.values].reverse().find((v) => v !== null);
        return { name: s.name, color: s.color, y: last === undefined || last === null ? NaN : y(last) };
      })
      .filter((l) => Number.isFinite(l.y))
      .sort((a, b) => a.y - b.y);
    if (labels.some((l, i) => i > 0 && l.y - labels[i - 1]!.y < 14)) labels = [];
  }

  const stride = scatter ? 1 : labelStride(n, plotW, Math.max(...p.categories.map((c) => c.length)));
  const count = scatter ? p.categories.length : n;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setActive((a) => (a === null ? 0 : Math.min(count - 1, a + 1)));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setActive((a) => (a === null ? 0 : Math.max(0, a - 1)));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(count - 1);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  // Bars: grouped (≤24px each, 2px surface gap) or stacked (2px gap between segments).
  const nS = p.series.length;
  const stacked = Boolean(spec.stacked) && p.kind === 'bar';
  const barW = stacked ? Math.max(2, Math.min(24, band * 0.6)) : Math.max(2, Math.min(24, (band * 0.8 - (nS - 1) * 2) / nS));
  const groupW = stacked ? barW : nS * barW + (nS - 1) * 2;
  const singleValueLabels = p.kind === 'bar' && nS === 1 && n <= 16 && band >= Math.max(...p.series[0]!.values.map((v) => formatValue(v).length)) * 7 + 4;

  const bars =
    p.kind !== 'bar'
      ? null
      : p.categories.map((_, i) => {
          const dim = active !== null && active !== i ? 0.45 : 1;
          if (!stacked) {
            return (
              <g key={i} opacity={dim}>
                {p.series.map((s, j) => {
                  const v = s.values[i];
                  if (v === null || v === undefined) return null;
                  const x = cx(i) - groupW / 2 + j * (barW + 2);
                  return <path key={s.key} d={barPath(x, barW, baseline, y(v))} fill={s.color} />;
                })}
                {singleValueLabels && p.series[0]!.values[i] !== null ? (
                  <text x={cx(i)} y={(p.series[0]!.values[i] ?? 0) >= 0 ? y(p.series[0]!.values[i]!) - 6 : y(p.series[0]!.values[i]!) + 14} textAnchor="middle" fontSize="11" fill="var(--lm-text-2)">
                    {formatValue(p.series[0]!.values[i]!)}
                  </text>
                ) : null}
              </g>
            );
          }
          let pos = 0;
          let neg = 0;
          const segs = p.series.map((s) => {
            const v = s.values[i] ?? 0;
            const from = v >= 0 ? pos : neg;
            const to = from + v;
            if (v >= 0) pos = to;
            else neg = to;
            return { s, from, to, v };
          });
          const topPos = [...segs].reverse().find((g) => g.v > 0);
          const topNeg = [...segs].reverse().find((g) => g.v < 0);
          const x = cx(i) - barW / 2;
          return (
            <g key={i} opacity={dim}>
              {segs.map(({ s, from, to, v }) => {
                if (!v) return null;
                // Shrink each segment by 1px at both joins so neighbours sit 2px apart.
                const y0 = y(from) + (from === 0 ? 0 : v > 0 ? -1 : 1);
                const y1 = y(to) + (v > 0 ? 1 : -1);
                const end = (v > 0 && topPos?.s === s) || (v < 0 && topNeg?.s === s);
                if (end) return <path key={s.key} d={barPath(x, barW, y0, y(to))} fill={s.color} />;
                return <rect key={s.key} x={x} width={barW} y={Math.min(y0, y1)} height={Math.max(0, Math.abs(y1 - y0))} fill={s.color} />;
              })}
            </g>
          );
        });

  const tooltip =
    active === null ? null : scatter ? (
      (() => {
        const xv = p.xs[active];
        const xPos = xv === null || xv === undefined ? left : sx(xv);
        return (
          <Tooltip x={xPos} width={width}>
            <div className="mb-1 text-fg-2">{spec.x}: <span className="text-fg">{formatValue(xv ?? null)}</span></div>
            {p.series.map((s) => <TooltipRow key={s.key} color={s.color} name={s.name} value={formatValue(s.values[active] ?? null)} mark="dot" />)}
          </Tooltip>
        );
      })()
    ) : (
      <Tooltip x={cx(active)} width={width}>
        <div className="mb-1 font-medium text-fg">{p.categories[active]}</div>
        {p.series.map((s) => <TooltipRow key={s.key} color={s.color} name={s.name} value={formatValue(s.values[active] ?? null)} />)}
      </Tooltip>
    );

  const summary = `${spec.title ?? 'Chart'}: ${p.kind} chart of ${p.series.map((s) => s.name).join(', ')} by ${spec.x}, ${n} points. Use arrow keys to read values, or switch to the table view.`;

  return (
    <div className="flex flex-col gap-2">
      {p.series.length >= 2 ? <Legend items={p.series} mark={p.kind === 'line' ? 'line' : p.kind === 'scatter' ? 'dot' : 'rect'} /> : null}
      {p.omitted.length ? <p className="text-xs text-fg-2">Showing the first {p.series.length} series so they stay distinguishable. {p.omitted.join(', ')} {p.omitted.length === 1 ? 'is' : 'are'} in the table view.</p> : null}
      <div
        ref={ref}
        className="relative w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        tabIndex={0}
        role="group"
        aria-label={`${spec.title ?? 'Chart'} — interactive`}
        aria-describedby={descId}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <p id={descId} className="sr-only">{summary}</p>
        <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block select-none overflow-visible" fontFamily="var(--lm-font-sans)">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 && !scatter ? AXIS : GRID} strokeWidth="1" />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--lm-text-2)">{fmtY(t)}</text>
            </g>
          ))}
          {scatter
            ? xTicks.map((t) => (
                <text key={t} x={sx(t)} y={top + plotH + 18} textAnchor="middle" fontSize="11" fill="var(--lm-text-2)">{fmtX(t)}</text>
              ))
            : p.categories.map((c, i) =>
                i % stride === 0 ? (
                  <text key={i} x={cx(i)} y={top + plotH + 18} textAnchor="middle" fontSize="11" fill="var(--lm-text-2)">{c.length > 18 ? `${c.slice(0, 17)}…` : c}</text>
                ) : null,
              )}
          {spec.xLabel ? <text x={left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" fontSize="11" fill="var(--lm-text-2)">{spec.xLabel}</text> : null}
          {spec.yLabel ? <text transform={`translate(12 ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="var(--lm-text-2)">{spec.yLabel}</text> : null}

          {bars}

          {p.kind === 'area' || p.kind === 'line'
            ? p.series.map((s) => {
                const pts = points(s.values);
                const d = linePath(pts);
                const valid = pts.filter((q): q is { x: number; y: number } => q !== null);
                const area = p.kind === 'area' && valid.length > 1 ? `${d}L${valid[valid.length - 1]!.x},${baseline}L${valid[0]!.x},${baseline}Z` : null;
                const last = valid[valid.length - 1];
                return (
                  <g key={s.key}>
                    {area ? <path d={area} fill={s.color} fillOpacity="0.1" /> : null}
                    <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {last && active === null ? <circle cx={last.x} cy={last.y} r="4" fill={s.color} stroke={SURFACE} strokeWidth="2" /> : null}
                  </g>
                );
              })
            : null}

          {labels.map((l) => (
            <text key={l.name} x={left + plotW + 8} y={l.y} dy="0.32em" fontSize="11" fill="var(--lm-text-2)">{l.name.length > 18 ? `${l.name.slice(0, 17)}…` : l.name}</text>
          ))}

          {scatter
            ? p.series.map((s) =>
                points(s.values).map((pt, i) =>
                  pt ? <circle key={`${s.key}-${i}`} cx={pt.x} cy={pt.y} r={active === i ? 5 : 4} fill={s.color} stroke={SURFACE} strokeWidth="2" opacity={active !== null && active !== i ? 0.5 : 1} /> : null,
                ),
              )
            : null}

          {/* Crosshair + active dots for line/area. */}
          {active !== null && (p.kind === 'line' || p.kind === 'area') ? (
            <g pointerEvents="none">
              <line x1={cx(active)} x2={cx(active)} y1={top} y2={top + plotH} stroke="var(--lm-text-3)" strokeWidth="1" />
              {p.series.map((s) => {
                const v = s.values[active];
                return v === null || v === undefined ? null : <circle key={s.key} cx={cx(active)} cy={y(v)} r="4" fill={s.color} stroke={SURFACE} strokeWidth="2" />;
              })}
            </g>
          ) : null}

          {/* Hit targets: full-height bands for categorical charts, ≥24px circles for scatter. */}
          {scatter
            ? p.series.map((s) =>
                points(s.values).map((pt, i) => (pt ? <circle key={`hit-${s.key}-${i}`} cx={pt.x} cy={pt.y} r="12" fill="transparent" onPointerEnter={() => setActive(i)} /> : null)),
              )
            : p.categories.map((_, i) => <rect key={`hit-${i}`} x={left + band * i} y={top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} />)}
        </svg>
        {tooltip}
      </div>
    </div>
  );
}

function PartToWhole({ spec }: { spec: ChartSpec }) {
  const { mode, parts, total } = useMemo(() => partToWhole(spec), [spec]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const colorMode = useColorMode();
  if (!parts.length) return <RenderError title="Nothing to plot">The chart has no positive values.</RenderError>;
  const pct = (s: number) => `${(s * 100).toFixed(s < 0.1 ? 1 : 0)}%`;

  if (mode === 'segmented') {
    const gaps = (parts.length - 1) * 2;
    const avail = width - gaps;
    return (
      <div className="flex flex-col gap-3">
        <Legend items={parts} mark="rect" />
        <div ref={ref} className="relative w-full" onPointerLeave={() => setActive(null)}>
          <div className="flex h-12 w-full gap-[2px]" role="list" aria-label={`${spec.title ?? 'Breakdown'} — ${parts.length} parts`}>
            {parts.map((part, i) => {
              const w = avail * part.share;
              const label = pct(part.share);
              const fits = w >= label.length * 7 + 16;
              const fill = CHART_PALETTES[colorMode][i]!;
              return (
                <div
                  key={part.name}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${part.name}: ${formatValue(part.value)} (${label})`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="flex min-w-[2px] items-center justify-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  style={{
                    flexGrow: part.value,
                    flexBasis: 0,
                    background: part.color,
                    color: readableOn(fill),
                    opacity: active !== null && active !== i ? 0.55 : 1,
                    borderRadius: `${i === 0 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
                  }}
                >
                  {fits ? label : null}
                </div>
              );
            })}
          </div>
          {active !== null ? (
            <Tooltip x={(parts.slice(0, active).reduce((s, q) => s + q.share, 0) + parts[active]!.share / 2) * avail} width={width}>
              <TooltipRow color={parts[active]!.color} name={parts[active]!.name} value={`${formatValue(parts[active]!.value)} · ${pct(parts[active]!.share)}`} mark="dot" />
            </Tooltip>
          ) : null}
        </div>
        <p className="text-xs text-fg-2">Total {formatValue(total)}</p>
      </div>
    );
  }

  // Ranked bars: more than six parts are compared, not glanced at — one hue, largest first.
  const nameW = Math.min(160, Math.max(...parts.map((q) => q.name.length)) * 7 + 12);
  const valueW = Math.max(...parts.map((q) => `${formatValue(q.value)} (${pct(q.share)})`.length)) * 7 + 12;
  const plotW = Math.max(40, width - nameW - valueW);
  const rowH = 28;
  const max = parts[0]!.value;
  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setActive(null)}>
      <svg width={width} height={parts.length * rowH} role="img" aria-label={`${spec.title ?? 'Breakdown'}: ${parts.map((q) => `${q.name} ${pct(q.share)}`).join(', ')}`} fontFamily="var(--lm-font-sans)">
        {parts.map((q, i) => {
          const yTop = i * rowH + 6;
          const end = nameW + (q.value / max) * plotW;
          return (
            <g key={q.name} opacity={active !== null && active !== i ? 0.55 : 1} onPointerEnter={() => setActive(i)}>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" />
              <text x={nameW - 8} y={yTop + 8} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--lm-text)">{q.name.length > 22 ? `${q.name.slice(0, 21)}…` : q.name}</text>
              <path d={hBarPath(nameW, end, yTop, 16)} fill={q.color} />
              <text x={end + 6} y={yTop + 8} dy="0.32em" fontSize="11" fill="var(--lm-text-2)">{formatValue(q.value)} ({pct(q.share)})</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
