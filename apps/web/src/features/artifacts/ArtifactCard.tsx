import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '@lumen/shared';
import { cn } from '@lumen/ui';
import { AppWindow, BarChart3, Code2, FileText, GitBranch, Image, Loader2, Presentation, Sigma, Table2, XCircle } from 'lucide-react';
import type { LiveArtifact } from '../chat/store.js';
import { useArtifactPanel } from './panel.js';

export const ARTIFACT_TOOLS = new Set(['create_artifact', 'update_artifact', 'rewrite_artifact']);

const ICONS: Record<ArtifactType, typeof FileText> = {
  markdown: FileText, code: Code2, html: AppWindow, react: AppWindow, svg: Image, mermaid: GitBranch, chart: BarChart3, table: Table2, slides: Presentation, spreadsheet: Table2, latex: Sigma,
};

export function ArtifactTypeIcon({ type, size = 16, className }: { type: ArtifactType; size?: number; className?: string }) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon size={size} aria-hidden="true" className={className} />;
}

/** Works out which artifact a tool call touched, from live stream events or the stored tool result. */
export function describeArtifactCall(name: string, args: Record<string, unknown>, result: { content: string; isError: boolean } | undefined, live: LiveArtifact[] = []) {
  const fromResult = result && !result.isError ? /id: ([0-9a-f-]{36})/.exec(result.content)?.[1] : undefined;
  const id = typeof args.id === 'string' ? args.id : fromResult;
  const event = live.find((e) => (id ? e.id === id : name === 'create_artifact' && e.title === args.title));
  const version = event?.version ?? (result ? Number(/version (\d+)/.exec(result.content)?.[1]) || undefined : undefined);
  const title = event?.title ?? (typeof args.title === 'string' ? args.title : (result ? /artifact "(.+?)"/.exec(result.content)?.[1] : undefined)) ?? 'Artifact';
  const type = (event?.artifactType ?? (typeof args.type === 'string' ? args.type : undefined)) as ArtifactType | undefined;
  return { id: id ?? event?.id, version, title, type, action: name === 'create_artifact' ? 'Created' : 'Updated' };
}

export function ArtifactCard({ name, args, result, live }: { name: string; args: Record<string, unknown>; result?: { content: string; isError: boolean }; live?: LiveArtifact[] }) {
  const open = useArtifactPanel((s) => s.open);
  const openId = useArtifactPanel((s) => s.openId);
  const d = describeArtifactCall(name, args, result, live);
  const state = !result ? 'running' : result.isError ? 'error' : 'done';
  return (
    <button
      type="button"
      disabled={!d.id}
      onClick={() => d.id && open(d.id)}
      aria-label={`${d.action} artifact: ${d.title}. Open`}
      aria-current={openId && openId === d.id ? 'true' : undefined}
      className={cn('my-2 flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-elevated px-3 py-2.5 text-left hover:bg-hover disabled:cursor-default', openId === d.id && 'border-accent')}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        {state === 'running' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : state === 'error' ? <XCircle size={16} className="text-danger" aria-hidden="true" /> : d.type ? <ArtifactTypeIcon type={d.type} /> : <FileText size={16} aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{d.title}</span>
        <span className="block truncate text-xs text-fg-2">
          {state === 'running' ? (name === 'create_artifact' ? 'Creating…' : 'Updating…') : state === 'error' ? `Couldn’t ${name === 'create_artifact' ? 'create' : 'update'}: ${result!.content.slice(0, 120)}` : `${d.action}${d.version ? ` · v${d.version}` : ''}${d.type ? ` · ${ARTIFACT_TYPE_LABELS[d.type] ?? d.type}` : ''}`}
        </span>
      </span>
      {d.id && state === 'done' ? <span className="text-xs font-medium text-accent">Open</span> : null}
    </button>
  );
}
