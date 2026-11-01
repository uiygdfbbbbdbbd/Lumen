import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, CardHeader, ConfirmDialog, Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, IconButton, Input, Skeleton, Textarea, toast } from '@lumen/ui';
import { Archive, Copy, Download, Globe, MessageSquarePlus, MoreHorizontal, NotebookPen, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { relativeTime } from '../../lib/i18n.js';
import { FilesPage } from '../files/FilesPage.js';
import { ModelSelector } from '../models/ModelSelector.js';
import { ProjectBadge } from './ProjectsPage.js';
import type { ProjectDashboard } from './types.js';

export function ProjectPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDashboard>(`/api/projects/${projectId}`) });
  const [instructions, setInstructions] = useState('');
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const [url, setUrl] = useState<{ url: string; recrawl: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setInstructions(dash.data?.project.instructions ?? ''), [dash.data?.project.instructions]);

  if (dash.isLoading) return <div className="mx-auto max-w-5xl p-8"><Skeleton className="h-40" /></div>;
  if (dash.isError || !dash.data) return <div className="mx-auto max-w-5xl p-8"><Banner tone="critical" title="Couldn’t open this project">{errorMessage(dash.error)}</Banner></div>;
  const { project: p, chats, usage, starters } = dash.data;
  const canEdit = p.role !== 'viewer';
  const refresh = () => qc.invalidateQueries({ queryKey: ['project', projectId] });
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/projects/${projectId}`, { method: 'PATCH', body });
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['projects'] })]);
      toast.success('Saved');
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e));
    }
  };
  const newChat = (prompt?: string) => navigate({ to: '/', search: { project: projectId, ...(prompt ? { prompt } : {}) } as never });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center gap-3">
        <ProjectBadge p={p} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{p.name}</h1>
          {p.description ? <p className="text-sm text-fg-2">{p.description}</p> : null}
        </div>
        <Button onClick={() => newChat()}><MessageSquarePlus size={16} aria-hidden="true" /> New chat</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton label="Project options" icon={<MoreHorizontal size={18} />} /></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={async () => { const c = await api<{ id: string }>(`/api/projects/${projectId}/duplicate`, { method: 'POST' }); await qc.invalidateQueries({ queryKey: ['projects'] }); await navigate({ to: '/projects/$projectId', params: { projectId: c.id } }); }}><Copy size={16} aria-hidden="true" /> Duplicate</DropdownMenuItem>
            <DropdownMenuItem onSelect={async () => {
              const data = await api<unknown>(`/api/projects/${projectId}/export`);
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
              a.download = `${p.name.replace(/[^\w.-]+/g, '_')}.lumen-project.json`;
              a.click();
            }}><Download size={16} aria-hidden="true" /> Export</DropdownMenuItem>
            {canEdit ? <DropdownMenuItem onSelect={() => patch({ archived: !p.archived })}><Archive size={16} aria-hidden="true" /> {p.archived ? 'Unarchive' : 'Archive'}</DropdownMenuItem> : null}
            {p.role === 'owner' ? (<><DropdownMenuSeparator /><DropdownMenuItem destructive onSelect={() => setDeleting(true)}><Trash2 size={16} aria-hidden="true" /> Delete project</DropdownMenuItem></>) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {p.role === 'viewer' ? <Banner tone="info">You have view-only access to this project.</Banner> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Chats" description={`${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens used in this project`} />
            {starters.length ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {starters.map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => newChat(s)}>{s}</Button>)}
              </div>
            ) : null}
            {chats.length ? (
              <ul className="divide-y divide-border">
                {chats.map((c) => (
                  <li key={c.id}><Link to="/c/$conversationId" params={{ conversationId: c.id }} className="flex justify-between gap-2 py-2 text-sm hover:underline"><span className="truncate">{c.title}</span><span className="shrink-0 text-xs text-fg-2">{relativeTime(c.lastMessageAt)}</span></Link></li>
                ))}
              </ul>
            ) : <p className="text-sm text-fg-2">No chats in this project yet.</p>}
          </Card>
          <Card>
            <CardHeader
              title="Knowledge"
              description="Files, notes and web pages the assistant can search in this project’s chats."
              action={canEdit ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setNote({ title: '', text: '' })}><NotebookPen size={14} aria-hidden="true" /> Add text</Button>
                  <Button size="sm" variant="secondary" onClick={() => setUrl({ url: '', recrawl: '' })}><Globe size={14} aria-hidden="true" /> Add web page</Button>
                </div>
              ) : null}
            />
            <FilesPage projectId={projectId} />
          </Card>
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Instructions" description="Applied to every chat in this project." />
            <Textarea aria-label="Project instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={!canEdit} className="min-h-40" maxLength={16000} />
            {canEdit ? <Button className="mt-2 w-full" variant="secondary" onClick={() => patch({ instructions })} disabled={instructions === p.instructions}>Save instructions</Button> : null}
          </Card>
          <Card>
            <CardHeader title="Default model" />
            <ModelSelector allowAuto value={p.defaultModelId ?? 'auto'} onChange={(id) => canEdit && patch({ defaultModelId: id === 'auto' ? null : id })} />
          </Card>
        </aside>
      </div>

      <Dialog open={Boolean(note)} onOpenChange={(o) => !o && setNote(null)}>
        <DialogContent title="Add text to knowledge" size="lg">
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            try { await api(`/api/projects/${projectId}/notes`, { method: 'POST', body: note }); setNote(null); await qc.invalidateQueries({ queryKey: ['files'] }); toast.success('Added'); } catch (err) { toast.error('Couldn’t add text', errorMessage(err)); }
          }}>
            <Field label="Title"><Input value={note?.title ?? ''} onChange={(e) => setNote((n) => n && { ...n, title: e.target.value })} required /></Field>
            <Field label="Text"><Textarea value={note?.text ?? ''} onChange={(e) => setNote((n) => n && { ...n, text: e.target.value })} className="min-h-48" required /></Field>
            <div className="flex justify-end"><Button type="submit">Add</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(url)} onOpenChange={(o) => !o && setUrl(null)}>
        <DialogContent title="Add a web page" description="We fetch the page’s main text. Optionally re-fetch it on a schedule.">
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            try { await api(`/api/projects/${projectId}/urls`, { method: 'POST', body: { url: url!.url, recrawlHours: url!.recrawl ? Number(url!.recrawl) : null } }); setUrl(null); await qc.invalidateQueries({ queryKey: ['files'] }); toast.success('Fetching page…'); } catch (err) { toast.error('Couldn’t add page', errorMessage(err)); }
          }}>
            <Field label="URL"><Input type="url" value={url?.url ?? ''} onChange={(e) => setUrl((u) => u && { ...u, url: e.target.value })} required placeholder="https://" /></Field>
            <Field label="Re-fetch every (hours)" optional><Input type="number" min={1} value={url?.recrawl ?? ''} onChange={(e) => setUrl((u) => u && { ...u, recrawl: e.target.value })} /></Field>
            <div className="flex justify-end"><Button type="submit">Add page</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete “${p.name}”?`} description="Its knowledge files are deleted. Chats stay in your history but leave the project." destructive confirmText={p.name} confirmLabel="Delete project" onConfirm={async () => { await api(`/api/projects/${projectId}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['projects'] }); await navigate({ to: '/projects' }); }} />
    </div>
  );
}
