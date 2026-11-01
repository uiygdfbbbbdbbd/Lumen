import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, MEMORY_MAX_CHARS, type MemoryCategory } from '@lumen/shared';
import { Badge, Banner, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, IconButton, Input, Select, Skeleton, SwitchRow, Textarea, cn, toast } from '@lumen/ui';
import { Brain, Download, MessageSquare, Pencil, Pin, PinOff, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { Markdown } from '../chat/Markdown.js';
import { usePreferences, useUpdatePreferences } from '../models/useModels.js';
import { downloadBlob } from '../artifacts/files.js';
import { memoryApi, memoryKeys, useMemories, useMemoryMutation, useMemorySummary, type ImportEntry, type Memory } from './api.js';

const SOURCE: Record<Memory['source'], string> = { ai: 'Saved by AI', user: 'Added by you', import: 'Imported', consolidation: 'Tidied up' };

function useProjects() {
  return useQuery({ queryKey: ['projects', false], queryFn: () => api<{ items: { id: string; name: string }[] }>('/api/projects?archived=false').then((r) => r.items), staleTime: 60_000 });
}

export function MemorySettings() {
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const enabled = prefs?.memoryEnabled !== false;
  return (
    <>
      <Card>
        <CardHeader title="Memory" description="Lumen can remember useful things about you across chats — like your preferences, ongoing projects and the people you mention — so you don’t have to repeat yourself. Temporary chats never use memory." />
        <SwitchRow label="Use memory" description="When off, nothing is read from or saved to memory. Your saved memories are kept." checked={enabled} onCheckedChange={(v) => update.mutate({ memoryEnabled: v })} />
        <SwitchRow label="Search past chats" description="Let the AI look up earlier conversations when you refer to them." checked={prefs?.chatHistorySearch !== false} onCheckedChange={(v) => update.mutate({ chatHistorySearch: v })} />
        {!enabled ? <Banner tone="warning" className="mt-2">Memory is paused.</Banner> : null}
      </Card>
      <MemoryList />
      <SummaryCard />
      <ImportCard />
      <DataCard />
    </>
  );
}

function AddMemory({ projects }: { projects: { id: string; name: string }[] }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('other');
  const [scope, setScope] = useState('');
  const create = useMemoryMutation(memoryApi.create);
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!content.trim()) return;
        create.mutate(
          { content: content.trim(), category, projectId: scope || null },
          { onSuccess: (r) => { setContent(''); toast.success(r.deduplicated ? 'Updated an existing memory' : 'Memory saved'); }, onError: (err) => toast.error('Couldn’t save memory', errorMessage(err)) },
        );
      }}
    >
      <label htmlFor="new-memory" className="text-sm font-medium text-fg">Add a memory</label>
      <Textarea id="new-memory" value={content} maxLength={MEMORY_MAX_CHARS} onChange={(e) => setContent(e.target.value)} placeholder="e.g. I prefer short answers with examples." className="min-h-16" />
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)} className="w-auto">
          {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Select aria-label="Where to use it" value={scope} onChange={(e) => setScope(e.target.value)} className="w-auto">
          <option value="">In all chats</option>
          {projects.map((p) => <option key={p.id} value={p.id}>Only in “{p.name}”</option>)}
        </Select>
        <span className="flex-1" />
        <span className="text-xs text-fg-3">{content.length}/{MEMORY_MAX_CHARS}</span>
        <Button type="submit" size="sm" disabled={!content.trim()} loading={create.isPending}>Save</Button>
      </div>
    </form>
  );
}

function MemoryList() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('all');
  const projects = useProjects();
  const list = useMemories({ q: debounced || undefined, category: category || undefined, scope });
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const items = list.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Your memories" description="Edit, pin or delete anything. Pinned memories are always available to the AI." />
      <AddMemory projects={projects.data ?? []} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Input type="search" aria-label="Search memories" placeholder="Search memories…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-48 flex-1" />
        <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
          <option value="">All categories</option>
          {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Select aria-label="Filter by scope" value={scope} onChange={(e) => setScope(e.target.value)} className="w-auto">
          <option value="all">Everywhere</option>
          <option value="global">All chats</option>
          {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="mt-3" aria-live="polite">
        {list.isLoading ? (
          <div className="flex flex-col gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : !items.length ? (
          <EmptyState icon={<Brain size={24} />} title={debounced || category || scope !== 'all' ? 'No memories match' : 'Nothing remembered yet'} description={debounced || category || scope !== 'all' ? 'Try another search or filter.' : 'Tell Lumen “remember that…” in any chat, or add one above.'} />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Memories">
            {items.map((m) => <MemoryRow key={m.id} m={m} projectName={m.projectId ? projectName.get(m.projectId) ?? 'a project' : null} />)}
          </ul>
        )}
        {items.length ? <p className="mt-2 text-xs text-fg-3">{items.length} {items.length === 1 ? 'memory' : 'memories'}</p> : null}
      </div>
    </Card>
  );
}

function MemoryRow({ m, projectName }: { m: Memory; projectName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [category, setCategory] = useState<MemoryCategory>(m.category);
  const update = useMemoryMutation(({ id, body }: { id: string; body: Parameters<typeof memoryApi.update>[1] }) => memoryApi.update(id, body));
  const remove = useMemoryMutation(memoryApi.remove);
  const qc = useQueryClient();
  const editRef = useRef<HTMLTextAreaElement>(null);

  // The row unmounts as soon as the list refreshes, so follow-ups can't depend on this component.
  const del = async () => {
    try {
      await remove.mutateAsync(m.id);
    } catch (e) {
      return toast.error('Couldn’t delete', errorMessage(e));
    }
    toast({
      title: 'Memory deleted',
      action: {
        label: 'Undo',
        onClick: () =>
          void memoryApi
            .create({ content: m.content, category: m.category, projectId: m.projectId, pinned: m.pinned })
            .then(() => qc.invalidateQueries({ queryKey: memoryKeys.all }))
            .catch((e: unknown) => toast.error('Couldn’t restore', errorMessage(e))),
      },
    });
  };

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ id: m.id, body: { content: draft, category } }, { onSuccess: () => setEditing(false), onError: (err) => toast.error('Couldn’t save', errorMessage(err)) });
            }}
          >
            <Textarea ref={editRef} aria-label="Memory text" value={draft} maxLength={MEMORY_MAX_CHARS} onChange={(e) => setDraft(e.target.value)} autoFocus className="min-h-16" />
            <div className="flex items-center gap-2">
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)} className="h-8 w-auto py-0 text-xs">
                {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>)}
              </Select>
              <span className="flex-1" />
              <Button size="sm" variant="secondary" onClick={() => { setDraft(m.content); setCategory(m.category); setEditing(false); }}>Cancel</Button>
              <Button size="sm" type="submit" disabled={!draft.trim()} loading={update.isPending}>Save</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-fg">{m.content}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
              <Badge>{MEMORY_CATEGORY_LABELS[m.category]}</Badge>
              {projectName ? <Badge tone="info">Only in {projectName}</Badge> : null}
              {m.pinned ? <Badge tone="accent"><Pin size={10} aria-hidden="true" /> Pinned</Badge> : null}
              <span>{SOURCE[m.source]} · {new Date(m.updatedAt).toLocaleDateString()}</span>
              {m.conversationId ? <Link to="/c/$conversationId" params={{ conversationId: m.conversationId }} className="inline-flex items-center gap-1 underline underline-offset-2"><MessageSquare size={11} aria-hidden="true" /> Source chat</Link> : null}
              {m.useCount ? <span>Used {m.useCount}×</span> : null}
            </p>
          </>
        )}
      </div>
      {!editing ? (
        <div className="flex shrink-0 items-center">
          <IconButton size="icon-sm" label={m.pinned ? 'Unpin memory' : 'Pin memory'} aria-pressed={m.pinned} icon={m.pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => update.mutate({ id: m.id, body: { pinned: !m.pinned } })} />
          <IconButton size="icon-sm" label="Edit memory" icon={<Pencil size={14} />} onClick={() => { setDraft(m.content); setCategory(m.category); setEditing(true); }} />
          <IconButton size="icon-sm" label="Delete memory" icon={<Trash2 size={14} />} onClick={() => void del()} />
        </div>
      ) : null}
    </li>
  );
}

function SummaryCard() {
  const summary = useMemorySummary();
  const tidy = useMemoryMutation(memoryApi.consolidate);
  const s = summary.data;
  return (
    <Card>
      <CardHeader
        title="Summary"
        description="A readable overview of what Lumen remembers, rewritten whenever memory is tidied up (duplicates merged, outdated facts removed)."
        action={<Button size="sm" variant="secondary" loading={tidy.isPending} onClick={() => tidy.mutate(undefined, { onSuccess: (r) => toast.success('Memory tidied up', `${r.merged} merged · ${r.removed} removed · ${r.total} kept`), onError: (e) => toast.error('Couldn’t tidy up', errorMessage(e)) })}><Sparkles size={14} aria-hidden="true" /> Tidy up now</Button>}
      />
      {summary.isLoading ? <Skeleton className="h-24" /> : s?.content ? (
        <>
          <div className="max-h-96 overflow-auto rounded-md border border-border px-4 py-2"><Markdown text={s.content} /></div>
          <p className="mt-2 text-xs text-fg-3">{s.consolidatedAt ? `Updated ${new Date(s.consolidatedAt).toLocaleString()}` : ''}{s.pendingWrites ? ` · ${s.pendingWrites} change${s.pendingWrites === 1 ? '' : 's'} since then` : ''}</p>
        </>
      ) : (
        <p className="text-sm text-fg-2">No summary yet. It’s created the first time memory is tidied up.</p>
      )}
    </Card>
  );
}

function ImportCard() {
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<(ImportEntry & { selected: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useMemoryMutation(({ list }: { list: { content: string; category: MemoryCategory }[] }) => memoryApi.import(list, null));
  const file = useRef<HTMLInputElement>(null);

  const preview = async (src: string) => {
    setBusy(true);
    try {
      const r = await memoryApi.preview(src);
      setEntries(r.map((e) => ({ ...e, selected: !e.rejected && !e.duplicate })));
      if (!r.length) toast.error('Nothing to import', 'No memories were found in that text.');
    } catch (e) {
      toast.error('Couldn’t read that', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const chosen = entries?.filter((e) => e.selected && !e.rejected) ?? [];
  return (
    <Card>
      <CardHeader title="Import from another assistant" description="Paste or upload a memory export (a list or JSON). You’ll review everything before it’s saved." />
      {!entries ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Memories to import" value={text} onChange={(e) => setText(e.target.value)} placeholder={'- Prefers concise answers\n- Works as a product designer\n- Training for a half marathon'} className="min-h-28 font-mono text-xs" />
          <div className="flex gap-2">
            <input ref={file} type="file" accept=".txt,.md,.json,text/plain,application/json" className="sr-only" aria-label="Upload memory export" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); setText(t); await preview(t); } e.target.value = ''; }} />
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}><Upload size={14} aria-hidden="true" /> Upload file</Button>
            <span className="flex-1" />
            <Button size="sm" disabled={!text.trim()} loading={busy} onClick={() => void preview(text)}>Preview</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border" aria-label="Import preview">
            {entries.map((e, i) => (
              <li key={i} className={cn('flex items-start gap-3 px-3 py-2', e.rejected && 'opacity-70')}>
                <Checkbox aria-label={`Import “${e.content}”`} checked={e.selected && !e.rejected} disabled={Boolean(e.rejected)} onCheckedChange={(v) => setEntries((list) => list!.map((x, j) => (j === i ? { ...x, selected: v === true } : x)))} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{e.content}</p>
                  <p className="mt-0.5 text-xs text-fg-2">{e.rejected ? <span className="text-danger">Won’t import: {e.rejected.toLowerCase()}</span> : e.duplicate ? 'Already remembered — importing updates it' : 'New'}</p>
                </div>
                <Select aria-label={`Category for “${e.content}”`} value={e.category} disabled={Boolean(e.rejected)} onChange={(ev) => setEntries((list) => list!.map((x, j) => (j === i ? { ...x, category: ev.target.value as MemoryCategory } : x)))} className="h-8 w-auto py-0 text-xs">
                  {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>)}
                </Select>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEntries(null)}>Back</Button>
            <span className="flex-1" />
            <Button
              size="sm"
              disabled={!chosen.length}
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { list: chosen.map(({ content, category }) => ({ content, category })) },
                  {
                    onSuccess: (r) => {
                      toast.success(`Imported ${r.created} ${r.created === 1 ? 'memory' : 'memories'}`, [r.merged ? `${r.merged} merged with existing` : '', r.skipped.length ? `${r.skipped.length} skipped` : ''].filter(Boolean).join(' · ') || undefined);
                      setEntries(null);
                      setText('');
                    },
                    onError: (e) => toast.error('Import failed', errorMessage(e)),
                  },
                )
              }
            >
              Import {chosen.length} selected
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DataCard() {
  const [confirm, setConfirm] = useState(false);
  const forget = useMemoryMutation(memoryApi.forgetAll);
  return (
    <Card>
      <CardHeader title="Your memory data" description="Download everything Lumen remembers, or erase it permanently." />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={async () => { try { const data = await memoryApi.exportData(); downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `lumen-memories-${new Date().toISOString().slice(0, 10)}.json`); } catch (e) { toast.error('Export failed', errorMessage(e)); } }}>
          <Download size={16} aria-hidden="true" /> Export memories
        </Button>
        <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 size={16} aria-hidden="true" /> Forget everything</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Forget everything?"
        description="Every memory and the summary are deleted permanently. This can’t be undone."
        confirmText="forget everything"
        confirmLabel="Forget everything"
        destructive
        onConfirm={async () => {
          try {
            const r = await forget.mutateAsync(undefined);
            toast.success(`Forgot ${r.deleted} ${r.deleted === 1 ? 'memory' : 'memories'}`);
          } catch (e) {
            toast.error('Couldn’t erase memory', errorMessage(e));
          }
        }}
      />
    </Card>
  );
}
