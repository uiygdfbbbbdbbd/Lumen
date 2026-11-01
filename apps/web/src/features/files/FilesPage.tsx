import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, IconButton, Input, Meter, Select, Skeleton, toast } from '@lumen/ui';
import { Download, Eye, FolderOpen, Pencil, RotateCw, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { formatBytes, relativeTime } from '../../lib/i18n.js';
import { FileIcon, STATUS_LABEL } from './FileIcon.js';
import { FilePreview } from './FilePreview.js';
import type { FileInfo } from './types.js';
import { fileUrl, uploadFile } from './upload.js';

const KINDS = ['image', 'pdf', 'document', 'presentation', 'spreadsheet', 'text', 'code', 'data', 'html', 'audio', 'video', 'archive', 'url'];

export function FilesPage({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FileInfo | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const key = ['files', projectId ?? 'mine', kind, q];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ items: FileInfo[] }>(`/api/files?limit=200${projectId ? `&projectId=${projectId}` : ''}${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((r) => r.items),
    refetchInterval: (query) => ((query.state.data as FileInfo[] | undefined)?.some((f) => f.status === 'queued' || f.status === 'processing') ? 1500 : false),
  });
  const storage = useQuery({ queryKey: ['storage'], queryFn: () => api<{ usedBytes: number; limitBytes: number; maxUploadBytes: number }>('/api/files/storage'), enabled: !projectId });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['files'] }), qc.invalidateQueries({ queryKey: ['storage'] }), qc.invalidateQueries({ queryKey: ['project'] })]);
  const items = useMemo(() => list.data ?? [], [list.data]);

  async function onFiles(files: File[]) {
    setUploading((n) => n + files.length);
    await Promise.all(
      files.map((f) =>
        uploadFile(f, { projectId })
          .catch((e: unknown) => toast.error(`Couldn’t upload ${f.name}`, errorMessage(e)))
          .finally(() => setUploading((n) => n - 1)),
      ),
    );
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {!projectId ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Files</h1>
            <p className="text-sm text-fg-2">Everything you’ve uploaded to chats and projects.</p>
          </div>
          {storage.data ? <Meter className="w-64" label="Storage" value={storage.data.usedBytes} max={storage.data.limitBytes} format={formatBytes} /> : null}
        </header>
      ) : null}
      <div
        className="flex flex-wrap items-end gap-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void onFiles([...e.dataTransfer.files]);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">Type<Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-40"><option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-sm">Search<Input value={q} onChange={(e) => setQ(e.target.value)} className="w-56" placeholder="File name" /></label>
        <Button onClick={() => input.current?.click()} loading={uploading > 0}><Upload size={16} aria-hidden="true" /> Upload</Button>
        <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files to upload" onChange={(e) => { if (e.target.files?.length) void onFiles([...e.target.files]); e.target.value = ''; }} />
        {selected.size ? <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 size={16} aria-hidden="true" /> Delete {selected.size}</Button> : null}
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {!list.isLoading && !items.length ? <Card><EmptyState icon={<FolderOpen size={32} />} title="No files yet" description="Upload files here, attach them in a chat, or drop them onto this page." /></Card> : null}
      {items.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Files</caption>
            <thead className="border-b border-border text-xs text-fg-2">
              <tr>
                <th className="w-10 p-3"><Checkbox aria-label="Select all files" checked={items.every((f) => selected.has(f.id))} onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((f) => f.id)) : new Set())} /></th>
                <th className="p-3">Name</th><th className="p-3">Size</th><th className="p-3">Status</th><th className="p-3">Added</th><th className="p-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="p-3"><Checkbox aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onCheckedChange={(v) => { const s = new Set(selected); if (v === true) s.add(f.id); else s.delete(f.id); setSelected(s); }} /></td>
                  <td className="p-3">
                    <button type="button" className="flex items-center gap-2 text-left hover:underline" onClick={() => setPreview(f)}>
                      <span className="text-fg-2"><FileIcon kind={f.kind} /></span>
                      <span className="max-w-80 truncate">{f.name}</span>
                    </button>
                  </td>
                  <td className="p-3 text-fg-2">{f.kind === 'url' ? '—' : formatBytes(f.sizeBytes)}</td>
                  <td className="p-3">
                    <Badge tone={f.status === 'ready' ? 'success' : f.status === 'failed' || f.status === 'quarantined' ? 'danger' : 'info'} title={f.error ?? undefined}>{STATUS_LABEL[f.status]}</Badge>
                  </td>
                  <td className="p-3 text-fg-2">{relativeTime(f.createdAt)}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      {f.status === 'failed' ? <IconButton label={`Retry ${f.name}`} icon={<RotateCw size={16} />} onClick={async () => { await api(`/api/files/${f.id}/retry`, { method: 'POST' }); await refresh(); }} /> : null}
                      <IconButton label={`Preview ${f.name}`} icon={<Eye size={16} />} onClick={() => setPreview(f)} />
                      <IconButton label={`Rename ${f.name}`} icon={<Pencil size={16} />} onClick={async () => { const name = window.prompt('New name', f.name); if (name && name !== f.name) { await api(`/api/files/${f.id}`, { method: 'PATCH', body: { name } }).catch((e: unknown) => toast.error('Rename failed', errorMessage(e))); await refresh(); } }} />
                      {f.kind !== 'url' ? <a href={fileUrl(f.id, true)} aria-label={`Download ${f.name}`} title="Download" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"><Download size={16} aria-hidden="true" /></a> : null}
                      <IconButton label={`Delete ${f.name}`} icon={<Trash2 size={16} />} onClick={async () => { await api(`/api/files/${f.id}`, { method: 'DELETE' }); await refresh(); toast.success('File deleted'); }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {preview ? <FilePreview file={preview} onClose={() => setPreview(null)} /> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${selected.size} files?`}
        description="They’ll be removed from every chat and project that uses them."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          const r = await api<{ deleted: number }>('/api/files/bulk-delete', { method: 'POST', body: { ids: [...selected] } });
          setSelected(new Set());
          await refresh();
          toast.success(`${r.deleted} files deleted`);
        }}
      />
    </div>
  );
}
