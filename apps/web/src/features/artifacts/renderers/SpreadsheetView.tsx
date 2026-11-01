import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { columnName, evaluateSheet, parseCsv, toCsv } from '@lumen/shared';
import { cn } from '@lumen/ui';
import { formatValue } from './chart-layout.js';

const MIN_ROWS = 20;
const MIN_COLS = 8;

/**
 * A light spreadsheet: CSV where cells may hold formulas. Values are computed by the shared formula engine;
 * the formula bar shows the raw cell. With `onChange`, edits produce new CSV (saved as a new version).
 */
export function SpreadsheetView({ content, onChange }: { content: string; onChange?: (csv: string) => void }) {
  const grid = useMemo(() => parseCsv(content, ','), [content]);
  const result = useMemo(() => evaluateSheet(grid), [grid]);
  const rows = Math.max(MIN_ROWS, grid.length + 1);
  const cols = Math.max(MIN_COLS, ...grid.map((r) => r.length + 1));
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const [draft, setDraft] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const raw = grid[sel[0]]?.[sel[1]] ?? '';

  const commit = (value: string) => {
    setDraft(null);
    if (!onChange || value === raw) return;
    const next = grid.map((r) => [...r]);
    while (next.length <= sel[0]) next.push([]);
    const row = next[sel[0]]!;
    while (row.length <= sel[1]) row.push('');
    row[sel[1]] = value;
    // Trim trailing empty rows/cells so the CSV stays tidy.
    const width = Math.max(...next.map((r) => r.findLastIndex((c) => c !== '') + 1));
    const trimmed = next.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    while (trimmed.length && trimmed[trimmed.length - 1]!.every((c) => c === '')) trimmed.pop();
    onChange(toCsv(trimmed));
  };

  const move = (dr: number, dc: number) => {
    setSel(([r, c]) => [Math.max(0, Math.min(rows - 1, r + dr)), Math.max(0, Math.min(cols - 1, c + dc))]);
    requestAnimationFrame(() => table.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus());
  };
  const onKey = (e: KeyboardEvent) => {
    if (draft !== null) return;
    const map: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    if (map[e.key]) {
      e.preventDefault();
      move(...map[e.key]!);
    } else if (onChange && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      setDraft(raw);
    } else if (onChange && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      commit('');
    } else if (onChange && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setDraft(e.key);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="w-12 font-mono text-xs text-fg-2" aria-label="Selected cell">{columnName(sel[1])}{sel[0] + 1}</span>
        <input
          aria-label="Formula bar"
          readOnly={!onChange}
          className="flex-1 rounded-sm bg-surface px-2 py-1 font-mono text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          value={draft ?? raw}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit(draft ?? raw);
              move(1, 0);
            } else if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={() => draft !== null && commit(draft)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table ref={table} role="grid" aria-label="Spreadsheet" className="border-collapse text-sm" onKeyDown={onKey}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-[2] w-10 border border-border bg-surface" aria-hidden="true" />
              {Array.from({ length: cols }, (_, c) => <th key={c} scope="col" className="sticky top-0 z-[1] min-w-24 border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg-2">{columnName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <th scope="row" className="sticky left-0 z-[1] border border-border bg-surface px-2 text-right text-xs font-medium text-fg-2">{r + 1}</th>
                {Array.from({ length: cols }, (_, c) => {
                  const cell = result[r]?.[c];
                  const selected = sel[0] === r && sel[1] === c;
                  const shown = cell ? (cell.error ?? (typeof cell.value === 'number' ? formatValue(cell.value) : cell.value === null ? '' : String(cell.value))) : '';
                  return (
                    <td
                      key={c}
                      role="gridcell"
                      tabIndex={selected ? 0 : -1}
                      data-selected={selected}
                      aria-selected={selected}
                      title={cell?.formula ? grid[r]?.[c] : undefined}
                      onClick={() => setSel([r, c])}
                      onDoubleClick={() => onChange && setDraft(grid[r]?.[c] ?? '')}
                      className={cn(
                        'h-7 max-w-64 truncate border border-border px-2 outline-none',
                        typeof cell?.value === 'number' && !cell.error ? 'text-right tabular-nums' : '',
                        cell?.error ? 'text-danger' : 'text-fg',
                        selected && 'outline-2 -outline-offset-2 outline-accent',
                      )}
                    >
                      {selected && draft !== null ? (
                        <input
                          autoFocus
                          aria-label={`Edit ${columnName(c)}${r + 1}`}
                          className="w-full bg-transparent font-mono outline-none"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault();
                              commit(draft);
                              move(e.key === 'Enter' ? 1 : 0, e.key === 'Tab' ? 1 : 0);
                            } else if (e.key === 'Escape') {
                              setDraft(null);
                              move(0, 0);
                            }
                          }}
                          onBlur={() => commit(draft)}
                        />
                      ) : (
                        shown
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
