import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@lumen/ui';
import { BookOpen, ExternalLink, Globe } from 'lucide-react';
import type { FileCitation, WebCitation } from '@lumen/shared';
import { api } from '../../lib/api.js';
import type { Citation } from './store.js';

const where = (l: FileCitation['location']) => [l.page ? `p. ${l.page}` : '', l.section ?? ''].filter(Boolean).join(' · ');
const isWeb = (c: Citation): c is WebCitation => c.kind === 'web';
const label = (c: Citation) => (isWeb(c) ? c.title : c.fileName);
/** Only http(s) links are ever rendered (sources come from the model's tools). */
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);

function SourceDialog({ c, onClose }: { c: FileCitation; onClose: () => void }) {
  const q = useQuery({ queryKey: ['chunk', c.chunkId], queryFn: () => api<{ content: string; fileName: string }>(`/api/chunks/${c.chunkId}`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`[${c.n}] ${c.fileName}`} description={where(c.location) || 'Source excerpt'} size="lg">
        {q.isLoading ? <Skeleton className="h-40" /> : <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-code-bg p-3 text-sm text-code">{q.data?.content ?? 'Source no longer available.'}</pre>}
      </DialogContent>
    </Dialog>
  );
}

export function CitationChip({ c }: { c: Citation }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  if (isWeb(c)) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" onMouseEnter={() => setOpen(true)} aria-label={`Source ${c.n}: ${c.title}`} className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-accent-soft px-1 align-super text-[10px] font-semibold text-accent no-underline hover:bg-accent hover:text-accent-fg">
            {c.n}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" onMouseLeave={() => setOpen(false)}>
          <div className="flex items-center gap-1.5 text-xs text-fg-2"><Globe size={12} aria-hidden="true" /> {c.siteName}</div>
          <div className="mt-1 text-sm font-semibold text-fg">{c.title}</div>
          <p className="mt-1 line-clamp-4 text-xs text-fg-2">{c.snippet}</p>
          {safeHref(c.url) ? <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1 text-xs text-accent underline">Open page <ExternalLink size={11} aria-hidden="true" /></a> : null}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" onMouseEnter={() => setOpen(true)} aria-label={`Source ${c.n}: ${c.fileName}`} className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-accent-soft px-1 align-super text-[10px] font-semibold text-accent no-underline hover:bg-accent hover:text-accent-fg">
            {c.n}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" onMouseLeave={() => setOpen(false)}>
          <div className="text-xs font-semibold text-fg">{c.fileName}</div>
          {where(c.location) ? <div className="text-xs text-fg-2">{where(c.location)}</div> : null}
          <p className="mt-2 text-xs text-fg-2">{c.snippet}</p>
          <button type="button" className="mt-2 text-xs text-accent underline" onClick={() => { setOpen(false); setFull(true); }}>View source</button>
        </PopoverContent>
      </Popover>
      {full ? <SourceDialog c={c} onClose={() => setFull(false)} /> : null}
    </>
  );
}

export function SourcesList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<FileCitation | null>(null);
  if (!citations.length) return null;
  return (
    <details className="mt-2 rounded-md border border-border bg-surface text-sm">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-fg-2"><BookOpen size={14} aria-hidden="true" /> {citations.length} sources</summary>
      <ol className="flex flex-col gap-1 border-t border-border px-3 py-2">
        {citations.map((c) =>
          isWeb(c) ? (
            <li key={`web-${c.n}`}>
              <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer nofollow" className="text-xs hover:underline">
                <span className="font-semibold text-accent">[{c.n}]</span> {label(c)} <span className="text-fg-2">— {c.siteName}</span>
              </a>
            </li>
          ) : (
            <li key={c.chunkId}>
              <button type="button" onClick={() => setOpen(c)} className="text-left text-xs hover:underline">
                <span className="font-semibold text-accent">[{c.n}]</span> {c.fileName}
                {where(c.location) ? <span className="text-fg-2"> — {where(c.location)}</span> : null}
              </button>
            </li>
          ),
        )}
      </ol>
      {open ? <SourceDialog c={open} onClose={() => setOpen(null)} /> : null}
    </details>
  );
}

/** Turn "[3]" into a markdown link the renderer can recognize, only for known citation numbers. */
export function linkCitations(text: string, count: number): string {
  if (!count) return text;
  return text.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => (Number(n) >= 1 && Number(n) <= count ? `[${n}](#cite-${n})` : m));
}
