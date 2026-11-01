import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ARTIFACT_TYPE_LABELS, evaluateSheet, parseChartSpec, parseCsv, toCsv } from '@lumen/shared';
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  Textarea,
  cn,
  toast,
} from '@lumen/ui';
import { Code2, Copy, Download, Eye, FolderInput, GitFork, Globe, History, Link2, Maximize2, Minimize2, MoreHorizontal, Pencil, Redo2, Sparkles, Terminal, Trash2, Undo2, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { artifactApi, useArtifact, useArtifactMutation, useArtifactVersions } from './api.js';
import type { ConsoleEntry, FrameHandle } from './ArtifactFrame.js';
import { downloadBlob, editorLanguage, embedSnippet, extensionFor, mimeFor, printElement, publicUrl, safeFileName, serializeSvg, svgToPng } from './files.js';
import { ArtifactRenderer } from './renderers/ArtifactRenderer.js';
import { ArtifactFixContext } from './renderers/RenderError.js';
import { VersionHistory } from './VersionHistory.js';
import type { Artifact } from './types.js';

const CodeEditor = lazy(() => import('./monaco-editor.js'));

type View = 'preview' | 'code' | 'history';

export interface ArtifactPanelProps {
  artifactId: string;
  version: number | null;
  onVersionChange: (v: number | null) => void;
  onClose: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Sends a message to the chat this artifact belongs to (enables "Fix with AI" and "Edit with AI"). */
  onAsk?: (text: string) => void;
}

export function ArtifactPanel(props: ArtifactPanelProps) {
  const q = useArtifact(props.artifactId, props.version ?? undefined);
  if (q.isLoading) {
    return (
      <PanelShell {...props} title="Loading…">
        <div className="flex flex-col gap-3 p-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64" /></div>
      </PanelShell>
    );
  }
  if (q.isError || !q.data) {
    return (
      <PanelShell {...props} title="Artifact">
        <div className="p-4"><Banner tone="critical" title="Couldn’t open this artifact">{errorMessage(q.error)}</Banner></div>
      </PanelShell>
    );
  }
  return <LoadedPanel key={q.data.id} {...props} artifact={q.data} />;
}

function PanelShell({ title, onClose, fullscreen, children }: ArtifactPanelProps & { title: string; children: ReactNode }) {
  return (
    <aside aria-label={`Artifact: ${title}`} className={cn('flex min-h-0 flex-col border-l border-border bg-bg', fullscreen ? 'fixed inset-0 z-40' : 'h-full')}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{title}</h2>
        <IconButton label="Close artifact" icon={<X size={18} />} onClick={onClose} />
      </header>
      {children}
    </aside>
  );
}

function LoadedPanel({ artifact: a, onVersionChange, onClose, fullscreen, onToggleFullscreen, onAsk }: ArtifactPanelProps & { artifact: Artifact }) {
  const navigate = useNavigate();
  const viewingOld = a.viewingVersion !== a.version;
  const [view, setView] = useState<View>(a.type === 'code' ? 'code' : 'preview');
  const [draft, setDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [selection, setSelection] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<(ConsoleEntry & { at: number })[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [redo, setRedo] = useState<number[]>([]);
  // Bumped to throw away unsaved edits: the editor is uncontrolled and remounts with fresh content.
  const [editorEpoch, setEditorEpoch] = useState(0);
  // The version the unsaved edits started from, to warn if the artifact changes underneath them.
  const [draftBase, setDraftBase] = useState<number | null>(null);
  const frame = useRef<FrameHandle>(null);
  const body = useRef<HTMLDivElement>(null);
  const versions = useArtifactVersions(a.id);

  // New content (AI edit, restore, version switch) resets transient runtime state.
  useEffect(() => {
    setLogs([]);
    setRuntimeError(null);
  }, [a.content]);

  const save = useArtifactMutation(({ content, label }: { content: string; label?: string }) => artifactApi.saveVersion(a.id, content, a.viewingVersion, label ?? null));
  const restore = useArtifactMutation((v: number) => artifactApi.restore(a.id, v));
  const patch = useArtifactMutation((body: { title?: string; projectId?: string | null }) => artifactApi.patch(a.id, body));
  const publish = useArtifactMutation((on: boolean) => (on ? artifactApi.publish(a.id) : artifactApi.unpublish(a.id)));
  const fork = useArtifactMutation(() => artifactApi.fork(a.id));
  const remove = useArtifactMutation(() => artifactApi.remove(a.id));

  const content = draft ?? a.content;
  const dirty = draft !== null && draft !== a.content;
  const fileBase = safeFileName(a.title);

  const saveDraft = (label?: string) => {
    if (!dirty || draft === null) return;
    save.mutate(
      { content: draft, label },
      {
        onSuccess: () => {
          setDraft(null);
          setDraftBase(null);
          onVersionChange(null);
          toast.success(viewingOld ? `Saved as a new version based on v${a.viewingVersion}` : 'Saved as a new version');
        },
        onError: (e) => toast.error('Couldn’t save', errorMessage(e)),
      },
    );
  };

  // Undo = go back to the version the latest one was based on (as a new version, so history is kept).
  const latest = versions.data?.[0];
  const undoTarget = !viewingOld && latest && latest.version > 1 ? (latest.basedOn ?? latest.version - 1) : null;
  const undo = () => {
    if (!undoTarget || !latest) return;
    restore.mutate(undoTarget, { onSuccess: () => setRedo((r) => [...r, latest.version]), onError: (e) => toast.error('Undo failed', errorMessage(e)) });
  };
  const redoLast = () => {
    const v = redo[redo.length - 1];
    if (!v) return;
    restore.mutate(v, { onSuccess: () => setRedo((r) => r.slice(0, -1)), onError: (e) => toast.error('Redo failed', errorMessage(e)) });
  };

  const ask = onAsk
    ? (text: string) => {
        onAsk(text);
        toast.success('Sent to the chat');
      }
    : undefined;
  const fixWithAI = ask ? (error: string) => ask(`The artifact "${a.title}" (id: ${a.id}, version ${a.viewingVersion}) shows this error:\n\n\`\`\`\n${error.slice(0, 4000)}\n\`\`\`\n\nPlease fix it with update_artifact.`) : null;

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  const downloadSource = () => downloadBlob(new Blob([content], { type: `${mimeFor(a.type)};charset=utf-8` }), `${fileBase}.${extensionFor(a.type, a.language)}`);
  const exportServer = async (format: 'docx' | 'pptx') => {
    try {
      downloadBlob(await artifactApi.exportFile(a.id, format, a.viewingVersion), `${fileBase}.${format}`);
    } catch (e) {
      toast.error('Export failed', errorMessage(e));
    }
  };
  const renderedSvg = () => body.current?.querySelector<SVGSVGElement>('[data-chart] svg[role="img"], figure svg, svg[role="img"]') ?? null;
  const exportPng = async () => {
    try {
      const svg = a.type === 'svg' ? a.content : renderedSvg() ? serializeSvg(renderedSvg()!) : null;
      if (!svg) throw new Error('Open the preview first.');
      downloadBlob(await svgToPng(svg), `${fileBase}.png`);
    } catch (e) {
      toast.error('PNG export failed', errorMessage(e));
    }
  };
  const exportRenderedSvg = () => {
    const svg = renderedSvg();
    if (!svg) return toast.error('Open the preview first.');
    downloadBlob(new Blob([serializeSvg(svg)], { type: 'image/svg+xml' }), `${fileBase}.svg`);
  };
  const exportPdf = () => {
    if (a.type === 'html' || a.type === 'react') return frame.current?.print();
    setView('preview');
    requestAnimationFrame(() => body.current && printElement(body.current));
  };
  const exportValuesCsv = () => {
    const grid = parseCsv(a.content, ',');
    const values = evaluateSheet(grid).map((r) => r.map((c) => c.error ?? (c.value === null ? '' : typeof c.value === 'boolean' ? (c.value ? 'TRUE' : 'FALSE') : c.value)));
    downloadBlob(new Blob([toCsv(values)], { type: 'text/csv' }), `${fileBase} (values).csv`);
  };
  const exportChartCsv = () => {
    const r = parseChartSpec(a.content);
    if (!r.ok) return toast.error('This chart has errors', r.error);
    const cols = [r.spec.x, ...r.spec.y];
    downloadBlob(new Blob([toCsv([cols, ...r.spec.data.map((row) => cols.map((c) => row[c] ?? null))])], { type: 'text/csv' }), `${fileBase}.csv`);
  };

  const copyLink = async (slug: string) => {
    await navigator.clipboard.writeText(publicUrl(slug));
    toast.success('Public link copied');
  };
  const togglePublish = () =>
    publish.mutate(!a.published, {
      onSuccess: (r) => {
        const s = r as { publicSlug: string | null };
        if (s.publicSlug) void copyLink(s.publicSlug);
        else toast.success('Unpublished — the link no longer works');
      },
      onError: (e) => toast.error(a.published ? 'Couldn’t unpublish' : 'Couldn’t publish', errorMessage(e)),
    });

  // Capture selections in the preview for "Edit selection with AI".
  useEffect(() => {
    const el = body.current;
    if (!el || view !== 'preview') return;
    const onUp = () => {
      const s = window.getSelection();
      setSelection(s && !s.isCollapsed && el.contains(s.anchorNode) ? s.toString() : '');
    };
    el.addEventListener('mouseup', onUp);
    el.addEventListener('keyup', onUp);
    return () => {
      el.removeEventListener('mouseup', onUp);
      el.removeEventListener('keyup', onUp);
    };
  }, [view]);

  const hasPreview = a.type !== 'code';
  const runnable = a.type === 'html' || a.type === 'react';
  const errors = logs.filter((l) => l.level === 'error').length + (runtimeError ? 1 : 0);

  return (
    <aside aria-label={`Artifact: ${a.title}`} className={cn('flex min-h-0 min-w-0 flex-col border-l border-border bg-bg', fullscreen ? 'fixed inset-0 z-40' : 'h-full')}>
      <header className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        {renaming ? (
          <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get('title') ?? '').trim(); setRenaming(false); if (t && t !== a.title) patch.mutate({ title: t }); }}>
            <input name="title" defaultValue={a.title} autoFocus maxLength={200} aria-label="Artifact title" onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="w-full rounded-sm bg-surface px-2 py-1 text-sm font-semibold text-fg outline-none" />
          </form>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg"><button type="button" className="max-w-full truncate rounded-sm px-1 text-left hover:bg-hover" title="Rename" onClick={() => setRenaming(true)}>{a.title}</button></h2>
        )}
        <Badge>{ARTIFACT_TYPE_LABELS[a.type]}</Badge>
        <Select aria-label="Version" value={String(a.viewingVersion)} onChange={(e) => onVersionChange(Number(e.target.value) === a.version ? null : Number(e.target.value))} className="h-8 w-auto py-0 text-xs">
          {(versions.data ?? [{ version: a.version, label: null }]).map((v) => <option key={v.version} value={v.version}>v{v.version}{v.label ? ` · ${v.label}` : ''}{v.version === a.version ? ' (latest)' : ''}</option>)}
        </Select>
        <IconButton size="icon-sm" label="Undo last change" icon={<Undo2 size={15} />} disabled={!undoTarget || restore.isPending} onClick={undo} />
        <IconButton size="icon-sm" label="Redo" icon={<Redo2 size={15} />} disabled={!redo.length || restore.isPending || viewingOld} onClick={redoLast} />
        <IconButton size="icon-sm" label="Copy" icon={<Copy size={15} />} onClick={() => void copy()} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton size="icon-sm" label="Download or export" icon={<Download size={15} />} /></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Download</DropdownMenuLabel>
            <DropdownMenuItem onSelect={downloadSource}>Source (.{extensionFor(a.type, a.language)})</DropdownMenuItem>
            {['markdown', 'latex', 'code'].includes(a.type) ? <DropdownMenuItem onSelect={() => void exportServer('docx')}>Word document (.docx)</DropdownMenuItem> : null}
            {a.type === 'slides' ? <DropdownMenuItem onSelect={() => void exportServer('pptx')}>PowerPoint (.pptx)</DropdownMenuItem> : null}
            {a.type !== 'code' ? <DropdownMenuItem onSelect={exportPdf}>PDF (print)</DropdownMenuItem> : null}
            {['svg', 'chart', 'mermaid'].includes(a.type) ? <DropdownMenuItem onSelect={() => void exportPng()}>Image (.png)</DropdownMenuItem> : null}
            {['chart', 'mermaid'].includes(a.type) ? <DropdownMenuItem onSelect={exportRenderedSvg}>Image (.svg)</DropdownMenuItem> : null}
            {a.type === 'chart' ? <DropdownMenuItem onSelect={exportChartCsv}>Data (.csv)</DropdownMenuItem> : null}
            {a.type === 'spreadsheet' ? <DropdownMenuItem onSelect={exportValuesCsv}>Computed values (.csv)</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton size="icon-sm" label={a.published ? 'Sharing: published' : 'Share'} icon={<Globe size={15} className={a.published ? 'text-accent' : undefined} />} /></DropdownMenuTrigger>
          <DropdownMenuContent>
            {a.published && a.publicSlug ? (
              <>
                <DropdownMenuLabel>Published — anyone with the link can view</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void copyLink(a.publicSlug!)}><Link2 size={16} aria-hidden="true" /> Copy public link</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEmbedOpen(true)}><Code2 size={16} aria-hidden="true" /> Embed code</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={togglePublish}>Unpublish</DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={togglePublish}><Globe size={16} aria-hidden="true" /> Publish public link</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton size="icon-sm" label="More actions" icon={<MoreHorizontal size={15} />} /></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil size={16} aria-hidden="true" /> Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setProjectOpen(true)}><FolderInput size={16} aria-hidden="true" /> Save to project</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => fork.mutate(undefined, { onSuccess: (r) => { toast.success('Remixed — this is your copy'); void navigate({ to: '/artifacts', search: { open: (r as { id: string }).id } }); }, onError: (e) => toast.error('Remix failed', errorMessage(e)) })}
            >
              <GitFork size={16} aria-hidden="true" /> Remix (make a copy)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton size="icon-sm" label={fullscreen ? 'Exit full screen' : 'Full screen'} icon={fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />} onClick={onToggleFullscreen} />
        <IconButton size="icon-sm" label="Close artifact" icon={<X size={16} />} onClick={onClose} />
      </header>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1" role="tablist" aria-label="Artifact view">
        {hasPreview ? <ViewTab active={view === 'preview'} onClick={() => setView('preview')} icon={<Eye size={14} />}>Preview</ViewTab> : null}
        <ViewTab active={view === 'code'} onClick={() => setView('code')} icon={<Code2 size={14} />}>{a.type === 'code' ? 'Code' : 'Source'}</ViewTab>
        <ViewTab active={view === 'history'} onClick={() => setView('history')} icon={<History size={14} />}>History</ViewTab>
        <span className="flex-1" />
        {ask && selection.trim() ? <EditSelection selection={selection} onSubmit={(instruction) => ask(`In the artifact "${a.title}" (id: ${a.id}), change this part:\n\n\`\`\`\n${selection.slice(0, 6000)}\n\`\`\`\n\n${instruction}\n\nUse update_artifact to edit it in place.`)} /> : null}
      </div>

      {viewingOld ? (
        <Banner tone="info" className="rounded-none border-x-0 border-t-0" action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => onVersionChange(null)}>Back to latest</Button><Button size="sm" onClick={() => restore.mutate(a.viewingVersion, { onSuccess: () => onVersionChange(null) })}>Restore this version</Button></div>}>
          You’re viewing v{a.viewingVersion}{a.versionLabel ? ` (“${a.versionLabel}”)` : ''}. Edits here are saved as a new version based on it.
        </Banner>
      ) : null}
      {dirty ? (
        <div className="flex items-center gap-2 border-b border-border bg-accent-soft px-3 py-1.5 text-sm text-fg" role="status">
          {draftBase !== null && draftBase !== a.version ? `This artifact changed (now v${a.version}) while you were editing — saving replaces those changes.` : 'Unsaved changes'}
          <span className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => { setDraft(null); setDraftBase(null); setEditorEpoch((n) => n + 1); }}>Discard</Button>
          <Button size="sm" onClick={() => saveDraft()} disabled={save.isPending}>Save version</Button>
        </div>
      ) : null}

      <ArtifactFixContext.Provider value={fixWithAI}>
        <div ref={body} className="relative min-h-0 flex-1 overflow-auto" role="tabpanel">
          {view === 'history' ? (
            <VersionHistory artifactId={a.id} current={a.version} viewing={a.viewingVersion} canEdit onView={(v) => { onVersionChange(v); setView(hasPreview ? 'preview' : 'code'); }} />
          ) : view === 'code' ? (
            <Suspense fallback={<div className="h-full animate-pulse bg-surface" aria-label="Loading editor" />}>
              <div className="h-full min-h-[300px]">
                <CodeEditor key={`${a.viewingVersion}:${a.version}:${editorEpoch}`} value={content} language={editorLanguage(a.type, a.language)} label={`${a.title} source`} onChange={(v) => {
                    setDraft(v === a.content ? null : v);
                    setDraftBase((b) => (v === a.content ? null : (b ?? a.version)));
                  }} onSelectionChange={setSelection} onSave={() => saveDraft()} />
              </div>
            </Suspense>
          ) : (
            <ArtifactRenderer
              ref={frame}
              artifactId={a.id}
              type={a.type}
              title={a.title}
              content={content}
              language={a.language}
              onConsole={(e) => setLogs((l) => [...l.slice(-199), { ...e, at: Date.now() }])}
              onRuntimeError={setRuntimeError}
              onEdit={(csv) => save.mutate({ content: csv }, { onSuccess: () => onVersionChange(null), onError: (e) => toast.error('Couldn’t save', errorMessage(e)) })}
            />
          )}
        </div>
      </ArtifactFixContext.Provider>

      {runnable && view === 'preview' ? (
        <div className="border-t border-border">
          <div className="flex items-center gap-2 px-3 py-1">
            <button type="button" aria-expanded={consoleOpen} onClick={() => setConsoleOpen((o) => !o)} className="flex items-center gap-1.5 rounded-sm px-1 text-xs text-fg-2 hover:bg-hover">
              <Terminal size={13} aria-hidden="true" /> Console {logs.length ? `(${logs.length})` : ''}
              {errors ? <span className="text-danger">· {errors} error{errors > 1 ? 's' : ''}</span> : null}
            </button>
            <span className="flex-1" />
            {runtimeError && fixWithAI ? <Button size="sm" variant="secondary" onClick={() => fixWithAI(runtimeError)}><Sparkles size={13} aria-hidden="true" /> Fix with AI</Button> : null}
          </div>
          {runtimeError && !consoleOpen ? <p className="truncate px-3 pb-1.5 font-mono text-xs text-danger" role="alert">{runtimeError}</p> : null}
          {consoleOpen ? (
            <ol className="max-h-40 overflow-auto bg-code-bg px-3 py-1 font-mono text-xs" aria-label="Console output">
              {runtimeError ? <li className="text-danger">✖ {runtimeError}</li> : null}
              {logs.map((l, i) => <li key={i} className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-code'}>{l.level === 'error' ? '✖ ' : l.level === 'warn' ? '⚠ ' : '› '}{l.text}</li>)}
              {!logs.length && !runtimeError ? <li className="text-fg-3">No output.</li> : null}
            </ol>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this artifact?"
        description="All versions are deleted and any public link stops working."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => { onClose(); toast.success('Artifact deleted'); }, onError: (e) => toast.error('Couldn’t delete', errorMessage(e)) })}
      />
      <SaveToProject open={projectOpen} onOpenChange={setProjectOpen} current={a.projectId} onSave={(projectId) => patch.mutate({ projectId }, { onSuccess: () => toast.success(projectId ? 'Saved to project' : 'Removed from project'), onError: (e) => toast.error('Couldn’t move artifact', errorMessage(e)) })} />
      {a.publicSlug ? (
        <Dialog open={embedOpen} onOpenChange={setEmbedOpen}>
          <DialogContent title="Embed this artifact" description="Paste this snippet into any web page. Viewers see the published version.">
            <Textarea readOnly value={embedSnippet(a.publicSlug, a.title)} className="min-h-24 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Embed code" />
            <div className="mt-3 flex justify-end"><Button onClick={() => void navigator.clipboard.writeText(embedSnippet(a.publicSlug!, a.title)).then(() => toast.success('Embed code copied'))}>Copy</Button></div>
          </DialogContent>
        </Dialog>
      ) : null}
    </aside>
  );
}

function ViewTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium', active ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-hover')}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}

function EditSelection({ selection, onSubmit }: { selection: string; onSubmit: (instruction: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="secondary"><Sparkles size={13} aria-hidden="true" /> Edit selection with AI</Button></PopoverTrigger>
      <PopoverContent className="w-80">
        <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; onSubmit(text.trim()); setText(''); setOpen(false); }} className="flex flex-col gap-2">
          <p className="line-clamp-3 rounded-sm bg-surface px-2 py-1 font-mono text-xs text-fg-2">{selection}</p>
          <Field label="How should it change?"><Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus className="min-h-16" placeholder="e.g. make this friendlier" /></Field>
          <Button type="submit" size="sm" disabled={!text.trim()}>Send to chat</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function SaveToProject({ open, onOpenChange, current, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; current: string | null; onSave: (projectId: string | null) => void }) {
  const projects = useQuery({ queryKey: ['projects', false], queryFn: () => api<{ items: { id: string; name: string }[] }>('/api/projects?archived=false').then((r) => r.items), enabled: open });
  const [value, setValue] = useState(current ?? '');
  useEffect(() => setValue(current ?? ''), [current, open]);
  const items = useMemo(() => projects.data ?? [], [projects.data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Save to project" description="Project members can view this artifact, and editors can change it.">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSave(value || null); onOpenChange(false); }}>
          <Field label="Project">
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">No project</option>
              {items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit">Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
