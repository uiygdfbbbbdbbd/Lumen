import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ARTIFACT_TYPES, ARTIFACT_TYPE_LABELS } from '@lumen/shared';
import { Badge, EmptyState, Input, Skeleton, cn } from '@lumen/ui';
import { Globe, Layers, MessageSquare, Search } from 'lucide-react';
import { useArtifactList } from './api.js';
import { ArtifactWorkspace } from './ArtifactWorkspace.js';
import { useArtifactPanel } from './panel.js';
import { Thumbnail } from './Thumbnail.js';

export function ArtifactsPage() {
  const search = useSearch({ strict: false }) as { open?: string };
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<string>('');
  const list = useArtifactList({ q: debounced || undefined, type: type || undefined });
  const panel = useArtifactPanel();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const openPanel = panel.open;
  const closePanel = panel.close;
  useEffect(() => {
    if (search.open) openPanel(search.open);
  }, [search.open, openPanel]);
  useEffect(() => closePanel, [closePanel]);

  return (
    <ArtifactWorkspace>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <header className="mb-5 flex flex-wrap items-center gap-3">
            <h1 className="flex-1 text-2xl font-semibold tracking-tight">Artifacts</h1>
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden="true" />
              <Input type="search" aria-label="Search artifacts" placeholder="Search by title…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>
          </header>
          <div role="group" aria-label="Filter by type" className="mb-5 flex flex-wrap gap-1.5">
            {['', ...ARTIFACT_TYPES].map((t) => (
              <button key={t || 'all'} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', type === t ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-2 hover:bg-hover')}>
                {t ? ARTIFACT_TYPE_LABELS[t as keyof typeof ARTIFACT_TYPE_LABELS] : 'All'}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
          ) : !list.data?.length ? (
            <EmptyState
              icon={<Layers size={28} />}
              title={debounced || type ? 'No artifacts match' : 'No artifacts yet'}
              description={debounced || type ? 'Try a different search or type.' : 'Ask for a document, app, diagram, chart or slide deck in a chat and it appears here.'}
              action={!debounced && !type ? <Link to="/" className="text-sm font-medium text-accent underline">Start a chat</Link> : undefined}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your artifacts">
              {list.data.map((a) => (
                <li key={a.id}>
                  <article className={cn('overflow-hidden rounded-lg border bg-elevated', panel.openId === a.id ? 'border-accent' : 'border-border')}>
                    <button type="button" className="block w-full text-left hover:bg-hover" onClick={() => void navigate({ to: '/artifacts', search: { open: a.id }, replace: true })} aria-label={`Open ${a.title}`}>
                      <Thumbnail a={a} />
                      <div className="px-3 py-2.5">
                        <h2 className="truncate text-sm font-medium text-fg">{a.title}</h2>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-2">
                          {ARTIFACT_TYPE_LABELS[a.type]} · v{a.version} · {new Date(a.updatedAt).toLocaleDateString()}
                          {a.published ? <Badge tone="info"><Globe size={10} aria-hidden="true" /> Public</Badge> : null}
                        </p>
                      </div>
                    </button>
                    {a.conversationId ? (
                      <Link to="/c/$conversationId" params={{ conversationId: a.conversationId }} className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs text-fg-2 underline-offset-2 hover:underline">
                        <MessageSquare size={12} aria-hidden="true" /> Open chat
                      </Link>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ArtifactWorkspace>
  );
}
