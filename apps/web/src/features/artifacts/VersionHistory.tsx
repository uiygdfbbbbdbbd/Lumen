import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, IconButton, Input, Skeleton, toast } from '@lumen/ui';
import { Eye, GitCompare, History, Pencil, RotateCcw } from 'lucide-react';
import { errorMessage } from '../../lib/api.js';
import { artifactApi, useArtifactMutation, useArtifactVersions } from './api.js';
import { DiffView } from './DiffView.js';

const SOURCE: Record<string, string> = { ai: 'AI', user: 'You', restore: 'Restored', fork: 'Remixed' };

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 60) return rtf.format(-Math.round(s), 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

export function VersionHistory({ artifactId, current, viewing, canEdit, onView }: { artifactId: string; current: number; viewing: number; canEdit: boolean; onView: (v: number | null) => void }) {
  const versions = useArtifactVersions(artifactId);
  const [compare, setCompare] = useState<[number, number] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const restore = useArtifactMutation((v: number) => artifactApi.restore(artifactId, v));
  const label = useArtifactMutation(({ v, l }: { v: number; l: string | null }) => artifactApi.label(artifactId, v, l));
  const diff = useQuery({ queryKey: ['artifacts', 'diff', artifactId, compare], queryFn: () => artifactApi.diff(artifactId, compare![0], compare![1]), enabled: Boolean(compare), staleTime: Infinity });

  if (versions.isLoading) return <div className="flex flex-col gap-2 p-3"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  const items = versions.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="max-h-[45%] shrink-0 overflow-auto border-b border-border" aria-label="Versions">
        {items.map((v) => (
          <li key={v.version} className={`flex items-center gap-2 px-3 py-2 text-sm ${v.version === viewing ? 'bg-accent-soft' : ''}`}>
            <span className="w-8 font-mono text-xs text-fg-2">v{v.version}</span>
            <div className="min-w-0 flex-1">
              {editing === v.version ? (
                <form onSubmit={(e) => { e.preventDefault(); const l = String(new FormData(e.currentTarget).get('label') ?? '').trim(); setEditing(null); label.mutate({ v: v.version, l: l || null }, { onError: (err) => toast.error('Couldn’t rename version', errorMessage(err)) }); }}>
                  <Input name="label" defaultValue={v.label ?? ''} autoFocus maxLength={80} aria-label={`Name for version ${v.version}`} onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="h-7" />
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-fg">{v.label ?? `${SOURCE[v.source] ?? v.source} edit`}</span>
                  {v.version === current ? <Badge tone="accent">Latest</Badge> : null}
                </div>
              )}
              <div className="text-xs text-fg-2">{SOURCE[v.source] ?? v.source} · {ago(v.createdAt)}{v.basedOn && v.basedOn !== v.version - 1 ? ` · from v${v.basedOn}` : ''}</div>
            </div>
            <IconButton size="icon-sm" label={`View version ${v.version}`} icon={<Eye size={14} />} onClick={() => onView(v.version === current ? null : v.version)} />
            {v.version > 1 ? <IconButton size="icon-sm" label={`Compare version ${v.version} with ${v.version - 1}`} icon={<GitCompare size={14} />} onClick={() => setCompare([v.version - 1, v.version])} /> : null}
            {canEdit ? <IconButton size="icon-sm" label={`Name version ${v.version}`} icon={<Pencil size={14} />} onClick={() => setEditing(v.version)} /> : null}
            {canEdit && v.version !== current ? (
              <IconButton
                size="icon-sm"
                label={`Restore version ${v.version}`}
                icon={<RotateCcw size={14} />}
                onClick={() => restore.mutate(v.version, { onSuccess: () => { onView(null); toast.success(`Restored version ${v.version}`); }, onError: (e) => toast.error('Restore failed', errorMessage(e)) })}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex min-h-0 flex-1 flex-col">
        {compare ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-2">
              <GitCompare size={14} aria-hidden="true" /> Changes from v{compare[0]} to v{compare[1]}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setCompare(null)}>Close</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{diff.isLoading ? <Skeleton className="m-3 h-24" /> : diff.data !== undefined ? <DiffView patch={diff.data} /> : null}</div>
          </>
        ) : (
          <p className="flex items-center gap-2 p-4 text-sm text-fg-2"><History size={14} aria-hidden="true" /> Every change is kept. Compare versions, name them, or restore an earlier one — restoring adds a new version, so nothing is lost.</p>
        )}
      </div>
    </div>
  );
}
