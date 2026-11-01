import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Skeleton, Switch, toast } from '@lumen/ui';
import { Download, KeyRound, Pencil, Plug, Plus, Server, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { relativeTime } from '../../lib/i18n.js';
import { ProviderDialog } from './ProviderDialog.js';
import type { Presets, ProviderView, TestResult } from './types.js';

const HEALTH_TONE = { healthy: 'success', degraded: 'warning', down: 'danger', unknown: 'neutral' } as const;

function KeysDialog({ provider, onClose, onChange }: { provider: ProviderView | null; onClose: () => void; onChange: (p: ProviderView) => void }) {
  const [form, setForm] = useState({ label: '', apiKey: '', weight: 1, cap: '' });
  const [error, setError] = useState<string | null>(null);
  if (!provider) return null;
  const call = async (fn: () => Promise<ProviderView>) => {
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`API keys — ${provider.name}`} description="Requests are spread across enabled keys by weight. Rate-limited keys cool down automatically." size="lg">
        {error ? <Banner tone="critical" className="mb-3">{error}</Banner> : null}
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Keys</caption>
          <thead className="text-xs text-fg-3"><tr><th className="py-1">Label</th><th>Key</th><th>Weight</th><th>Spend (month)</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {provider.keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td className="py-2">{k.label}</td>
                <td><code>{k.keyPreview}</code></td>
                <td>{k.weight}</td>
                <td>${k.spentUsd.toFixed(2)}{k.monthlySpendCapUsd !== null ? ` / $${k.monthlySpendCapUsd}` : ''}</td>
                <td className="text-xs">{k.cooldownUntil && new Date(k.cooldownUntil) > new Date() ? <Badge tone="warning">Cooling down</Badge> : k.lastError ? <span className="text-danger">{k.lastError.slice(0, 40)}</span> : 'OK'}</td>
                <td className="flex items-center justify-end gap-1 py-2">
                  <Switch aria-label={`Enable ${k.label}`} checked={k.enabled} onCheckedChange={(v) => call(() => api(`/api/admin/providers/${provider.id}/keys/${k.id}`, { method: 'PATCH', body: { enabled: v } }))} />
                  <IconButton label={`Delete ${k.label}`} icon={<Trash2 size={16} />} onClick={() => call(() => api(`/api/admin/providers/${provider.id}/keys/${k.id}`, { method: 'DELETE' }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void call(async () => {
              const r = await api<ProviderView>(`/api/admin/providers/${provider.id}/keys`, { method: 'POST', body: { label: form.label || 'Key', apiKey: form.apiKey, weight: Number(form.weight), monthlySpendCapUsd: form.cap ? Number(form.cap) : null } });
              setForm({ label: '', apiKey: '', weight: 1, cap: '' });
              return r;
            });
          }}
        >
          <Field label="Label"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="API key" className="sm:col-span-2"><Input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required /></Field>
          <Field label="Weight"><Input type="number" min={1} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} /></Field>
          <Field label="Monthly cap ($)" optional><Input type="number" min={0} value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} /></Field>
          <div className="sm:col-span-5 flex justify-end"><Button type="submit" disabled={!form.apiKey}><Plus size={14} aria-hidden="true" /> Add key</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProvidersPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => api<{ items: ProviderView[] }>('/api/admin/providers').then((r) => r.items) });
  const presets = useQuery({ queryKey: ['admin', 'presets'], queryFn: () => api<Presets>('/api/admin/provider-presets') });
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [dialog, setDialog] = useState(false);
  const [keysFor, setKeysFor] = useState<ProviderView | null>(null);
  const [deleting, setDeleting] = useState<ProviderView | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | 'running'>>({});
  const iconInput = useRef<HTMLInputElement>(null);
  const iconFor = useRef<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const replace = (p: ProviderView) => qc.setQueryData<ProviderView[]>(['admin', 'providers'], (old) => (old ? (old.some((x) => x.id === p.id) ? old.map((x) => (x.id === p.id ? p : x)) : [...old, p]) : [p]));

  async function test(p: ProviderView) {
    setTests((t) => ({ ...t, [p.id]: 'running' }));
    try {
      const r = await api<TestResult>(`/api/admin/providers/${p.id}/test`, { method: 'POST' });
      setTests((t) => ({ ...t, [p.id]: r }));
      await refresh();
    } catch (e) {
      setTests((t) => ({ ...t, [p.id]: { ok: false, latencyMs: 0, modelCount: 0, sampleModels: [], completion: null, error: { kind: 'request', message: errorMessage(e) } } }));
    }
  }

  async function importModels(p: ProviderView) {
    try {
      const r = await api<{ added: number; existing: number }>(`/api/admin/providers/${p.id}/import-models`, { method: 'POST', body: { enable: false } });
      toast.success(`Imported ${r.added} new models`, r.added ? 'They start disabled — enable them on the Models page.' : `${r.existing} already present.`);
      await refresh();
    } catch (e) {
      toast.error('Import failed', errorMessage(e));
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">AI providers</h2>
          <p className="text-sm text-fg-2">Connect model APIs. Keys are encrypted and never leave the server.</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialog(true); }}><Plus size={16} aria-hidden="true" /> Add provider</Button>
      </header>
      {list.isLoading ? <Skeleton className="h-32" /> : null}
      {list.data?.length === 0 ? <Card><EmptyState icon={<Server size={32} />} title="No providers yet" description="Add OpenAI, Anthropic, Gemini, a local Ollama or any OpenAI-compatible endpoint." action={<Button onClick={() => setDialog(true)}>Add provider</Button>} /></Card> : null}
      <ul className="flex flex-col gap-3">
        {list.data?.map((p) => {
          const t = tests[p.id];
          return (
            <li key={p.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  {p.iconUrl ? <img src={p.iconUrl} alt="" width={36} height={36} className="rounded-md" /> : <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft font-bold text-accent" aria-hidden="true">{p.name[0]}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{p.name}</h3>
                      <Badge>{presets.data?.presets[p.type]?.label ?? p.type}</Badge>
                      <Badge tone={HEALTH_TONE[p.health.status]}>{p.health.status}</Badge>
                      {!p.enabled ? <Badge tone="warning">Disabled</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-fg-2">{p.baseUrl}</p>
                    <p className="text-xs text-fg-2">{p.modelCount} models · {p.keys.length} {p.keys.length === 1 ? 'key' : 'keys'}{p.health.lastCheckedAt ? ` · checked ${relativeTime(p.health.lastCheckedAt)}${p.health.latencyMs !== null ? ` (${p.health.latencyMs} ms)` : ''}` : ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" loading={t === 'running'} onClick={() => test(p)}><Plug size={14} aria-hidden="true" /> Test</Button>
                    <Button size="sm" variant="secondary" onClick={() => importModels(p)}><Download size={14} aria-hidden="true" /> Import models</Button>
                    <IconButton label={`Keys for ${p.name}`} icon={<KeyRound size={16} />} onClick={() => setKeysFor(p)} />
                    <IconButton label={`Upload icon for ${p.name}`} icon={<Upload size={16} />} onClick={() => { iconFor.current = p.id; iconInput.current?.click(); }} />
                    <IconButton label={`Edit ${p.name}`} icon={<Pencil size={16} />} onClick={() => { setEditing(p); setDialog(true); }} />
                    <IconButton label={`Delete ${p.name}`} icon={<Trash2 size={16} />} onClick={() => setDeleting(p)} />
                  </div>
                </div>
                {t && t !== 'running' ? (
                  <Banner tone={t.ok ? 'success' : 'critical'} title={t.ok ? `Connected in ${t.latencyMs} ms` : `Connection failed (${t.error?.kind})`} className="mt-3">
                    {t.ok ? <>Found {t.modelCount} models{t.sampleModels.length ? ` (${t.sampleModels.slice(0, 5).join(', ')}${t.modelCount > 5 ? ', …' : ''})` : ''}.{t.completion ? <> Sample reply: “{t.completion}”</> : null}</> : t.error?.message}
                  </Banner>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      <input
        ref={iconInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        className="sr-only"
        aria-label="Provider icon file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !iconFor.current) return;
          const fd = new FormData();
          fd.append('file', file);
          try {
            replace(await api<ProviderView>(`/api/admin/providers/${iconFor.current}/icon`, { method: 'POST', body: fd }));
            toast.success('Icon updated');
          } catch (err) {
            toast.error('Icon upload failed', errorMessage(err));
          }
        }}
      />
      <ProviderDialog open={dialog} onOpenChange={setDialog} presets={presets.data} editing={editing} onSaved={(p) => { replace(p); toast.success(editing ? 'Provider saved' : 'Provider added', editing ? undefined : 'Test the connection, then import models.'); }} />
      <KeysDialog provider={keysFor ? (list.data?.find((p) => p.id === keysFor.id) ?? keysFor) : null} onClose={() => setKeysFor(null)} onChange={(p) => { replace(p); setKeysFor(p); }} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Its models stop working immediately. Conversations keep their history."
        destructive
        confirmText={deleting?.name}
        confirmLabel="Delete provider"
        onConfirm={async () => {
          await api(`/api/admin/providers/${deleting!.id}`, { method: 'DELETE' });
          await refresh();
          toast.success('Provider deleted');
        }}
      />
    </>
  );
}
