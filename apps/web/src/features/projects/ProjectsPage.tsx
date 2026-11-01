import { useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Skeleton, Textarea, cn, toast } from '@lumen/ui';
import { FolderKanban, Plus, Upload } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { relativeTime } from '../../lib/i18n.js';
import type { Project, ProjectTemplate } from './types.js';

export function ProjectBadge({ p, size = 32 }: { p: Pick<Project, 'name' | 'color'>; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md font-bold text-white" style={{ width: size, height: size, background: p.color, fontSize: size * 0.45 }} aria-hidden="true">
      {p.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProjectsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const list = useQuery({ queryKey: ['projects', archived], queryFn: () => api<{ items: Project[] }>(`/api/projects?archived=${archived}`).then((r) => r.items) });
  const templates = useQuery({ queryKey: ['project-templates'], queryFn: () => api<{ items: ProjectTemplate[] }>('/api/project-templates').then((r) => r.items) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', instructions: '', templateId: '' });
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api<Project>('/api/projects', { method: 'POST', body: { name: form.name, description: form.description, instructions: form.instructions, ...(form.templateId ? { templateId: form.templateId } : {}) } });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      await navigate({ to: '/projects/$projectId', params: { projectId: p.id } });
    } catch (err) {
      toast.error('Couldn’t create project', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-fg-2">Group chats with shared instructions and a knowledge base.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setArchived((a) => !a)} aria-pressed={archived}>{archived ? 'Show active' : 'Show archived'}</Button>
          <Button variant="secondary" onClick={() => importInput.current?.click()}><Upload size={16} aria-hidden="true" /> Import</Button>
          <Button onClick={() => { setForm({ name: '', description: '', instructions: '', templateId: '' }); setOpen(true); }}><Plus size={16} aria-hidden="true" /> New project</Button>
        </div>
      </header>
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Project file to import"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const p = await api<Project>('/api/projects/import', { method: 'POST', body: JSON.parse(await file.text()) });
            await qc.invalidateQueries({ queryKey: ['projects'] });
            toast.success('Project imported');
            await navigate({ to: '/projects/$projectId', params: { projectId: p.id } });
          } catch (err) {
            toast.error('Import failed', errorMessage(err));
          }
        }}
      />
      {list.isLoading ? <Skeleton className="h-32" /> : null}
      {list.data && !list.data.length ? <Card><EmptyState icon={<FolderKanban size={32} />} title={archived ? 'No archived projects' : 'No projects yet'} description="Start from a template or a blank project." action={!archived ? <Button onClick={() => setOpen(true)}>New project</Button> : undefined} /></Card> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((p) => (
          <li key={p.id}>
            <Link to="/projects/$projectId" params={{ projectId: p.id }} className="flex h-full flex-col gap-2 rounded-lg border border-border bg-elevated p-4 hover:bg-hover">
              <span className="flex items-center gap-3">
                <ProjectBadge p={p} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-fg">{p.name}</span>
                  <span className="block text-xs text-fg-2">{p.role === 'owner' ? 'Owner' : p.role === 'editor' ? 'Editor' : 'Viewer'} · updated {relativeTime(p.updatedAt)}</span>
                </span>
              </span>
              {p.description ? <span className="line-clamp-2 text-sm text-fg-2">{p.description}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New project" description="Pick a template or start blank. You can change everything later." size="lg">
          <form className="flex flex-col gap-4" onSubmit={create}>
            <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-3">
              {[{ id: '', name: 'Blank', description: 'Start from scratch.', color: '#767686' }, ...(templates.data ?? [])].map((t) => (
                <button
                  key={t.id || 'blank'}
                  type="button"
                  role="radio"
                  aria-checked={form.templateId === t.id}
                  onClick={() => setForm((f) => ({ ...f, templateId: t.id, name: f.name || (t.id ? t.name : '') }))}
                  className={cn('flex flex-col gap-1 rounded-md border p-3 text-left', form.templateId === t.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover')}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-fg"><span className="h-3 w-3 rounded-full" style={{ background: t.color }} aria-hidden="true" />{t.name}</span>
                  <span className="text-xs text-fg-2">{t.description}</span>
                </button>
              ))}
            </div>
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} /></Field>
            <Field label="Description" optional><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} /></Field>
            <Field label="Instructions" optional hint="Leave empty to use the template’s instructions."><Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy} disabled={!form.name.trim()}>Create project</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
