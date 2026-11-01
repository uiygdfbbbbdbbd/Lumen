import { useMemo, useState } from 'react';
import { parseCsv } from '@lumen/shared';
import { Input } from '@lumen/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';

const PAGE = 500;
const isNum = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v.replace(/[,$%\s]/g, '')));

export function TableView({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [head = [], ...body] = rows;
  const numeric = useMemo(() => head.map((_, c) => body.length > 0 && body.every((r) => !r[c]?.trim() || isNum(r[c]!))), [head, body]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? body.filter((r) => r.some((c) => c.toLowerCase().includes(needle))) : body;
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        const x = a[col] ?? '';
        const y = b[col] ?? '';
        return (numeric[col] ? Number(x.replace(/[,$%\s]/g, '')) - Number(y.replace(/[,$%\s]/g, '')) : x.localeCompare(y, undefined, { numeric: true })) * dir;
      });
    }
    return out;
  }, [body, q, sort, numeric]);
  if (!rows.length) return <p className="p-4 text-sm text-fg-2">This table is empty.</p>;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Input aria-label="Filter rows" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <span className="text-xs text-fg-2" aria-live="polite">{shown.length.toLocaleString()} of {body.length.toLocaleString()} rows</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr>
              {head.map((h, c) => (
                <th key={c} scope="col" aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="border-b border-border p-0 text-left font-medium text-fg">
                  <button type="button" className="flex w-full items-center gap-1 px-3 py-1.5 hover:bg-hover" onClick={() => setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}>
                    {h || `Column ${c + 1}`}
                    {sort?.col === c ? (sort.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {head.map((_, c) => <td key={c} className={`px-3 py-1 text-fg ${numeric[c] ? 'text-right tabular-nums' : ''}`}>{r[c] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > limit ? <button type="button" className="w-full p-2 text-sm text-accent hover:bg-hover" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more rows</button> : null}
      </div>
    </div>
  );
}
