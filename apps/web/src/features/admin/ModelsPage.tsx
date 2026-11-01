import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MODEL_VISIBILITY } from '@lumen/shared';
import { Badge, Banner, Button, Card, CardHeader, Checkbox, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, Switch, Textarea, toast } from '@lumen/ui';
import { Boxes, Pencil, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import type { ProviderView } from './types.js';

interface AdminModel {
  id: string;
  providerId: string;
  providerModelId: string;
  displayName: string;
  description: string;
  iconUrl: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Record<'vision' | 'tools' | 'json' | 'reasoning' | 'audio' | 'imageGen', boolean>;
  pricing: { inputPer1M: number; outputPer1M: number } | null;
  systemPromptPrefix: string;
  enabled: boolean;
  visibility: (typeof MODEL_VISIBILITY)[number];
  tags: string[];
  sortOrder: number;
  recommended: boolean;
  rpmLimit: number | null;
  dailyTokenCap: number | null;
  fallbackModelIds: string[];
  deprecationDate: string | null;
  deprecationMessage: string | null;
  replacementModelId: string | null;
  aliases: string[];
}

const CAPS = ['vision', 'tools', 'json', 'reasoning', 'audio', 'imageGen'] as const;

function EditModel({ model, all, onClose, onSaved }: { model: AdminModel; all: AdminModel[]; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState(model);
  const [tags, setTags] = useState(model.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AdminModel>(k: K, v: AdminModel[K]) => setM((x) => ({ ...x, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/models/${m.id}`, {
        method: 'PATCH',
        body: {
          displayName: m.displayName,
          description: m.description,
          contextWindow: Number(m.contextWindow),
          maxOutputTokens: Number(m.maxOutputTokens),
          capabilities: m.capabilities,
          pricing: m.pricing && (m.pricing.inputPer1M || m.pricing.outputPer1M) ? { inputPer1M: Number(m.pricing.inputPer1M), outputPer1M: Number(m.pricing.outputPer1M) } : null,
          systemPromptPrefix: m.systemPromptPrefix,
          visibility: m.visibility,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          sortOrder: Number(m.sortOrder),
          recommended: m.recommended,
          rpmLimit: m.rpmLimit ? Number(m.rpmLimit) : null,
          dailyTokenCap: m.dailyTokenCap ? Number(m.dailyTokenCap) : null,
          fallbackModelIds: m.fallbackModelIds,
          deprecationDate: m.deprecationDate || null,
          deprecationMessage: m.deprecationMessage || null,
          replacementModelId: m.replacementModelId || null,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const others = all.filter((x) => x.id !== m.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Edit ${model.displayName}`} description={model.providerModelId} size="lg">
        <form onSubmit={save} className="flex flex-col gap-4">
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name"><Input value={m.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
            <Field label="Tags" hint="Comma separated, e.g. fast, new, smart"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          </div>
          <Field label="Description" optional><Input value={m.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Context window"><Input type="number" value={m.contextWindow} onChange={(e) => set('contextWindow', Number(e.target.value))} /></Field>
            <Field label="Max output"><Input type="number" value={m.maxOutputTokens} onChange={(e) => set('maxOutputTokens', Number(e.target.value))} /></Field>
            <Field label="Input $ / 1M"><Input type="number" step="0.01" min={0} value={m.pricing?.inputPer1M ?? ''} onChange={(e) => set('pricing', { inputPer1M: Number(e.target.value), outputPer1M: m.pricing?.outputPer1M ?? 0 })} /></Field>
            <Field label="Output $ / 1M"><Input type="number" step="0.01" min={0} value={m.pricing?.outputPer1M ?? ''} onChange={(e) => set('pricing', { inputPer1M: m.pricing?.inputPer1M ?? 0, outputPer1M: Number(e.target.value) })} /></Field>
          </div>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium">Capabilities</legend>
            {CAPS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <Checkbox checked={m.capabilities[c]} onCheckedChange={(v) => set('capabilities', { ...m.capabilities, [c]: v === true })} />
                {c === 'imageGen' ? 'Image generation' : c[0]!.toUpperCase() + c.slice(1)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Visibility"><Select value={m.visibility} onChange={(e) => set('visibility', e.target.value as AdminModel['visibility'])}>{MODEL_VISIBILITY.map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field>
            <Field label="Requests / minute" optional><Input type="number" min={1} value={m.rpmLimit ?? ''} onChange={(e) => set('rpmLimit', e.target.value ? Number(e.target.value) : null)} /></Field>
            <Field label="Daily token cap" optional><Input type="number" min={1} value={m.dailyTokenCap ?? ''} onChange={(e) => set('dailyTokenCap', e.target.value ? Number(e.target.value) : null)} /></Field>
          </div>
          <Field label="System prompt prefix" optional hint="Prepended to every conversation using this model."><Textarea value={m.systemPromptPrefix} onChange={(e) => set('systemPromptPrefix', e.target.value)} /></Field>
          <Field label="Fallback chain" optional hint="Tried in order if this model fails. Hold Ctrl/Cmd to pick several.">
            <Select multiple className="h-24" value={m.fallbackModelIds} onChange={(e) => set('fallbackModelIds', [...e.target.selectedOptions].map((o) => o.value).slice(0, 5))}>
              {others.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Deprecation date" optional><Input type="date" value={m.deprecationDate ?? ''} onChange={(e) => set('deprecationDate', e.target.value || null)} /></Field>
            <Field label="Replacement" optional><Select value={m.replacementModelId ?? ''} onChange={(e) => set('replacementModelId', e.target.value || null)}><option value="">None</option>{others.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}</Select></Field>
            <Field label="Migration notice" optional><Input value={m.deprecationMessage ?? ''} onChange={(e) => set('deprecationMessage', e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ModelsPage() {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => api<{ items: ProviderView[] }>('/api/admin/providers').then((r) => r.items) });
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: () => api<{ items: AdminModel[] }>('/api/admin/models').then((r) => r.items) });
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminModel | null>(null);
  const [alias, setAlias] = useState({ alias: '', modelId: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'models'] }).then(() => qc.invalidateQueries({ queryKey: ['models'] }));

  const rows = useMemo(
    () => (models.data ?? []).filter((m) => (!provider || m.providerId === provider) && (!q || `${m.displayName} ${m.providerModelId}`.toLowerCase().includes(q.toLowerCase()))),
    [models.data, provider, q],
  );
  const providerName = (id: string) => providers.data?.find((p) => p.id === id)?.name ?? '';

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/admin/models/${id}`, { method: 'PATCH', body });
      await refresh();
    } catch (e) {
      toast.error('Update failed', errorMessage(e));
    }
  };
  const bulk = async (enabled: boolean) => {
    const r = await api<{ updated: number }>('/api/admin/models/bulk', { method: 'POST', body: { ids: [...selected], enabled } });
    toast.success(`${r.updated} models ${enabled ? 'enabled' : 'disabled'}`);
    setSelected(new Set());
    await refresh();
  };

  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">Models</h2>
        <p className="text-sm text-fg-2">Choose which models people can use, how they’re described, and who can see them.</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Provider"><Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-48"><option value="">All providers</option>{providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} className="w-56" /></Field>
        {selected.size ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => bulk(true)}>Enable {selected.size}</Button>
            <Button variant="secondary" onClick={() => bulk(false)}>Disable {selected.size}</Button>
          </div>
        ) : null}
      </div>
      {models.isLoading ? <Skeleton className="h-40" /> : null}
      {models.data?.length === 0 ? <Card><EmptyState icon={<Boxes size={32} />} title="No models yet" description="Add a provider, then use “Import models”." /></Card> : null}
      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Models</caption>
            <thead className="border-b border-border text-xs text-fg-3">
              <tr>
                <th className="w-10 p-3"><Checkbox aria-label="Select all" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                <th className="p-3">Model</th><th className="p-3">Provider</th><th className="p-3">Visibility</th><th className="p-3">Recommended</th><th className="p-3">Enabled</th><th className="p-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="p-3"><Checkbox aria-label={`Select ${m.displayName}`} checked={selected.has(m.id)} onCheckedChange={(v) => { const s = new Set(selected); if (v === true) s.add(m.id); else s.delete(m.id); setSelected(s); }} /></td>
                  <td className="p-3">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="flex flex-wrap gap-1 text-xs text-fg-3"><code>{m.providerModelId}</code>{m.aliases.map((a) => <Badge key={a} tone="info">@{a}</Badge>)}{m.deprecationDate ? <Badge tone="danger">deprecated</Badge> : null}</div>
                  </td>
                  <td className="p-3 text-fg-2">{providerName(m.providerId)}</td>
                  <td className="p-3"><Select aria-label={`Visibility of ${m.displayName}`} value={m.visibility} onChange={(e) => patch(m.id, { visibility: e.target.value })} className="h-8 w-32">{MODEL_VISIBILITY.map((v) => <option key={v} value={v}>{v}</option>)}</Select></td>
                  <td className="p-3"><Switch aria-label={`Recommend ${m.displayName}`} checked={m.recommended} onCheckedChange={(v) => patch(m.id, { recommended: v })} /></td>
                  <td className="p-3"><Switch aria-label={`Enable ${m.displayName}`} checked={m.enabled} onCheckedChange={(v) => patch(m.id, { enabled: v })} /></td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Edit ${m.displayName}`} icon={<Pencil size={16} />} onClick={() => setEditing(m)} />
                      <IconButton label={`Delete ${m.displayName}`} icon={<Trash2 size={16} />} onClick={async () => { await api(`/api/admin/models/${m.id}`, { method: 'DELETE' }); await refresh(); toast.success('Model removed'); }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Aliases" description="Stable names like “smart” or “fast” that you can repoint to a different model without breaking users or API clients." />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('/api/admin/model-aliases', { method: 'PUT', body: alias });
              setAlias({ alias: '', modelId: '' });
              await refresh();
              toast.success('Alias saved');
            } catch (err) {
              toast.error('Could not save alias', errorMessage(err));
            }
          }}
        >
          <Field label="Alias"><Input value={alias.alias} placeholder="smart" onChange={(e) => setAlias({ ...alias, alias: e.target.value })} /></Field>
          <Field label="Points to"><Select value={alias.modelId} onChange={(e) => setAlias({ ...alias, modelId: e.target.value })} className="w-56"><option value="">Choose a model</option>{models.data?.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select></Field>
          <Button type="submit" disabled={!alias.alias || !alias.modelId}>Save alias</Button>
        </form>
      </Card>
      {editing ? <EditModel model={editing} all={models.data ?? []} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </>
  );
}
