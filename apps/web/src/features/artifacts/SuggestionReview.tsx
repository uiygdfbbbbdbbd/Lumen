import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyPatch, structuredPatch, type StructuredPatchHunk } from 'diff';
import { Banner, Button, Skeleton, cn, toast } from '@lumen/ui';
import { Check, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { artifactApi, artifactKeys } from './api.js';
import type { Artifact } from './types.js';

export interface Suggestion {
  id: string;
  baseVersion: number;
  content: string;
  note: string;
  source: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export const suggestionsKey = (id: string) => ['artifacts', 'suggestions', id] as const;

export function useSuggestions(artifactId: string) {
  return useQuery({ queryKey: suggestionsKey(artifactId), queryFn: () => api<{ items: Suggestion[] }>(`/api/artifacts/${artifactId}/suggestions`).then((r) => r.items) });
}

type Decision = 'accept' | 'reject' | undefined;

/**
 * Apply only the accepted hunks of a suggestion to the current text. Hunks are located by their context,
 * so they still apply if the document changed elsewhere since the suggestion was made. Returns null on conflict.
 */
export function applyHunks(current: string, hunks: StructuredPatchHunk[], decisions: Decision[]): string | null {
  const accepted = hunks.filter((_, i) => decisions[i] === 'accept');
  if (!accepted.length) return current;
  const out = applyPatch(current, { oldFileName: 'a', newFileName: 'b', oldHeader: '', newHeader: '', hunks: accepted }, { fuzzFactor: 1 });
  return out === false ? null : out;
}

/** Tracked-changes review for an artifact's pending suggestions. */
export function SuggestionReview({ artifact }: { artifact: Artifact }) {
  const qc = useQueryClient();
  const list = useSuggestions(artifact.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision[]>>({});
  const [busy, setBusy] = useState(false);
  const pending = list.data ?? [];
  const s = pending.find((x) => x.id === selected) ?? pending[0];
  const base = useQuery({
    // Its own key: sharing the panel's artifact key would let a refetch run this function without a suggestion.
    queryKey: ['artifacts', 'suggestion-base', artifact.id, s?.baseVersion ?? 0],
    queryFn: () => api<Artifact>(`/api/artifacts/${artifact.id}?version=${s!.baseVersion}`),
    enabled: Boolean(s),
    staleTime: Infinity,
  });
  const hunks = useMemo(() => (s && base.data ? structuredPatch('a', 'b', base.data.content, s.content, '', '', { context: 2 }).hunks : []), [s, base.data]);
  const d = (s && decisions[s.id]) ?? [];
  const setD = (i: number, v: Decision) => s && setDecisions((all) => ({ ...all, [s.id]: Object.assign([...(all[s.id] ?? [])], { [i]: v }) }));
  const allDecided = hunks.length > 0 && hunks.every((_, i) => d[i]);

  if (list.isLoading) return <div className="p-3"><Skeleton className="h-24" /></div>;
  if (!s) return <p className="p-4 text-sm text-fg-2">No suggestions to review. Ask the AI to suggest changes, or use Quick actions.</p>;

  const finish = async () => {
    setBusy(true);
    try {
      const accepted = d.filter((x) => x === 'accept').length;
      if (accepted) {
        const next = applyHunks(artifact.content, hunks, d);
        if (next === null) {
          toast.error('Couldn’t apply', 'The document changed too much since this suggestion. Reject it and ask again.');
          return;
        }
        await artifactApi.saveVersion(artifact.id, next, artifact.version, accepted === hunks.length ? 'Accepted suggestion' : `Accepted ${accepted} of ${hunks.length} changes`);
      }
      await api(`/api/artifacts/${artifact.id}/suggestions/${s.id}/resolve`, { method: 'POST', body: { status: accepted ? 'accepted' : 'rejected' } });
      toast.success(accepted ? `Applied ${accepted} change${accepted === 1 ? '' : 's'}` : 'Suggestion rejected');
      setSelected(null);
      await qc.invalidateQueries({ queryKey: artifactKeys.all });
    } catch (e) {
      toast.error('Couldn’t finish the review', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {pending.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5" role="tablist" aria-label="Pending suggestions">
          {pending.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === s.id} onClick={() => setSelected(x.id)} className={cn('whitespace-nowrap rounded-sm px-2 py-1 text-xs', x.id === s.id ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-hover')}>
              {i + 1}. {x.note || 'Suggestion'}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-fg">{s.note || 'Suggested changes'} <span className="text-xs text-fg-2">· {hunks.length} change{hunks.length === 1 ? '' : 's'}{s.baseVersion !== artifact.version ? ` · made on v${s.baseVersion}` : ''}</span></span>
        <Button size="sm" variant="ghost" onClick={() => s && setDecisions((a) => ({ ...a, [s.id]: hunks.map(() => 'accept' as const) }))}>Accept all</Button>
        <Button size="sm" variant="ghost" onClick={() => s && setDecisions((a) => ({ ...a, [s.id]: hunks.map(() => 'reject' as const) }))}>Reject all</Button>
        <Button size="sm" disabled={!allDecided} loading={busy} onClick={() => void finish()}>Apply decisions</Button>
      </div>
      {s.baseVersion !== artifact.version ? <Banner tone="info" className="rounded-none border-x-0 border-t-0">The artifact changed since this suggestion. Accepted changes are applied where their surrounding text still matches.</Banner> : null}
      <ol className="min-h-0 flex-1 overflow-auto p-3" aria-label="Changes">
        {base.isLoading ? <Skeleton className="h-24" /> : null}
        {hunks.map((h, i) => (
          <li key={`${s.id}-${i}`} className={cn('mb-3 overflow-hidden rounded-md border', d[i] === 'accept' ? 'border-success' : d[i] === 'reject' ? 'border-border opacity-60' : 'border-border')}>
            <div className="flex items-center gap-2 bg-surface px-2 py-1 text-xs text-fg-2">
              <span className="flex-1">Change {i + 1} · line {h.newStart}</span>
              <Button size="sm" variant={d[i] === 'accept' ? 'primary' : 'secondary'} aria-pressed={d[i] === 'accept'} aria-label={`Accept change ${i + 1}`} onClick={() => setD(i, 'accept')}><Check size={12} aria-hidden="true" /> Accept</Button>
              <Button size="sm" variant={d[i] === 'reject' ? 'primary' : 'secondary'} aria-pressed={d[i] === 'reject'} aria-label={`Reject change ${i + 1}`} onClick={() => setD(i, 'reject')}><X size={12} aria-hidden="true" /> Reject</Button>
            </div>
            <pre className="m-0 overflow-x-auto bg-code-bg py-1 font-mono text-[12.5px] leading-5">
              {h.lines.map((l, j) => (
                <div key={j} className={cn('whitespace-pre-wrap px-2', l.startsWith('+') ? 'bg-[color-mix(in_srgb,var(--lm-success)_14%,transparent)] text-fg' : l.startsWith('-') ? 'bg-[color-mix(in_srgb,var(--lm-danger)_14%,transparent)] text-fg line-through decoration-fg-3' : 'text-fg-2')}>
                  {l.startsWith('+') ? <span className="sr-only">Added: </span> : l.startsWith('-') ? <span className="sr-only">Removed: </span> : null}
                  {l || ' '}
                </div>
              ))}
            </pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
