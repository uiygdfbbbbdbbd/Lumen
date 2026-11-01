import { useQuery } from '@tanstack/react-query';
import type { ChatStreamEvent, ResearchStep } from '@lumen/shared';
import { Button, cn } from '@lumen/ui';
import { Check, CircleDot, Loader2, Square, Telescope, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';

type LiveResearch = Extract<ChatStreamEvent, { type: 'research' }>;

interface Run {
  id: string;
  query: string;
  depth: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  step: ResearchStep;
  plan: string[];
  sources: { n: number; url: string; title: string; siteName: string }[];
  progress: { message: string; done: number; total: number };
  error: string | null;
}

const STEPS: { id: ResearchStep; label: string }[] = [
  { id: 'planning', label: 'Plan the research' },
  { id: 'searching', label: 'Search the web' },
  { id: 'reading', label: 'Read the best sources' },
  { id: 'writing', label: 'Write the report' },
];
const ORDER: ResearchStep[] = ['queued', 'planning', 'searching', 'reading', 'writing', 'done'];

/** Live progress for a Deep Research run (stream events while connected, polling as a fallback). */
export function ResearchCard({ runId, live, onStop }: { runId: string; live: LiveResearch | null; onStop?: () => void }) {
  const q = useQuery({
    queryKey: ['research', runId],
    queryFn: () => api<Run>(`/api/research/${runId}`),
    refetchInterval: (query) => (query.state.data && ['queued', 'running'].includes(query.state.data.status) && !live ? 4000 : false),
  });
  const run = q.data;
  const status = live?.status ?? run?.status ?? 'queued';
  const step = live?.step ?? run?.step ?? 'queued';
  const message = live?.message ?? run?.progress.message ?? 'Starting…';
  const done = live?.done ?? run?.progress.done ?? 0;
  const total = live?.total ?? run?.progress.total ?? 0;
  const sources = live?.sources ?? run?.sources ?? [];
  const active = status === 'queued' || status === 'running';
  const current = ORDER.indexOf(status === 'done' ? 'done' : step);

  if (status === 'done') {
    return (
      <p className="mb-2 flex items-center gap-2 text-xs text-fg-2"><Telescope size={14} aria-hidden="true" className="text-accent" /> Deep research · {sources.length} sources{run ? ` · ${run.depth}` : ''}</p>
    );
  }
  return (
    <section aria-label="Deep research progress" className="my-2 rounded-lg border border-border bg-elevated p-3">
      <div className="mb-2 flex items-center gap-2">
        <Telescope size={16} aria-hidden="true" className="text-accent" />
        <h3 className="flex-1 text-sm font-medium text-fg">{status === 'failed' ? 'Research failed' : status === 'cancelled' ? 'Research stopped' : 'Researching…'}</h3>
        {active && onStop ? <Button size="sm" variant="secondary" onClick={onStop}><Square size={12} aria-hidden="true" /> Stop</Button> : null}
      </div>
      <ol className="flex flex-col gap-1.5">
        {STEPS.map((s) => {
          const i = ORDER.indexOf(s.id);
          const state = i < current ? 'done' : i === current ? (active ? 'active' : status === 'failed' ? 'failed' : 'stopped') : 'todo';
          return (
            <li key={s.id} className={cn('flex items-center gap-2 text-sm', state === 'todo' ? 'text-fg-3' : 'text-fg')}>
              {state === 'done' ? <Check size={14} aria-hidden="true" className="text-success" /> : state === 'active' ? <Loader2 size={14} aria-hidden="true" className="animate-spin text-accent" /> : state === 'failed' ? <XCircle size={14} aria-hidden="true" className="text-danger" /> : <CircleDot size={14} aria-hidden="true" />}
              <span>{s.label}</span>
              <span className="sr-only">{state === 'done' ? '(done)' : state === 'active' ? '(in progress)' : ''}</span>
            </li>
          );
        })}
      </ol>
      {active ? (
        <div className="mt-3">
          <p className="text-xs text-fg-2" aria-live="polite">{message}</p>
          {total > 0 ? (
            <div role="progressbar" aria-label="Step progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ) : status === 'failed' ? (
        <p className="mt-2 text-sm text-fg-2" role="alert">{run?.error ?? message}</p>
      ) : null}
      {sources.length ? (
        <ul aria-label="Sources found" className="mt-3 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <li key={s.n}>
              <a href={/^https?:\/\//.test(s.url) ? s.url : undefined} target="_blank" rel="noopener noreferrer nofollow" title={s.title} className="inline-block max-w-48 truncate rounded-full border border-border px-2 py-0.5 text-xs text-fg-2 hover:bg-hover">{s.siteName}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
