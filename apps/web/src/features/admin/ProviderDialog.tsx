import { useEffect, useState } from 'react';
import { Banner, Button, Dialog, DialogContent, Field, Input, Select, SwitchRow, Textarea } from '@lumen/ui';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import type { Presets, ProviderType, ProviderView } from './types.js';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presets: Presets | undefined;
  editing: ProviderView | null;
  onSaved: (p: ProviderView) => void;
}

export function ProviderDialog({ open, onOpenChange, presets, editing, onSaved }: Props) {
  const [form, setForm] = useState({ name: '', type: 'openai' as ProviderType, description: '', baseUrl: '', organization: '', project: '', timeoutMs: 120000, maxRetries: 2, allowPrivateNetwork: false, enabled: true, notes: '', iconUrl: '' });
  const [apiKey, setApiKey] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);
  const [headers, setHeaders] = useState<{ k: string; v: string }[]>([]);
  const [headersTouched, setHeadersTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setErrors({});
    setApiKey('');
    setReplacingKey(false);
    setHeadersTouched(false);
    if (editing) {
      setForm({ name: editing.name, type: editing.type, description: editing.description, baseUrl: editing.baseUrl, organization: editing.organization ?? '', project: editing.project ?? '', timeoutMs: editing.timeoutMs, maxRetries: editing.maxRetries, allowPrivateNetwork: editing.allowPrivateNetwork, enabled: editing.enabled, notes: editing.notes, iconUrl: '' });
      setHeaders(editing.headerNames.map((k) => ({ k, v: '' })));
    } else {
      const p = presets?.presets.openai;
      setForm((f) => ({ ...f, name: '', type: 'openai', description: '', baseUrl: p?.baseUrl ?? '', organization: '', project: '', notes: '', iconUrl: '', allowPrivateNetwork: false, enabled: true }));
      setHeaders([]);
    }
  }, [open, editing, presets]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const keyless = presets?.presets[form.type]?.needsKey === false;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const body: Record<string, unknown> = {
      name: form.name,
      type: form.type,
      description: form.description,
      baseUrl: form.baseUrl,
      organization: form.organization || null,
      project: form.project || null,
      timeoutMs: Number(form.timeoutMs),
      maxRetries: Number(form.maxRetries),
      allowPrivateNetwork: form.allowPrivateNetwork,
      enabled: form.enabled,
      notes: form.notes,
    };
    if (form.iconUrl) body.iconUrl = form.iconUrl;
    if (!editing || replacingKey) {
      if (apiKey) body.apiKey = apiKey;
    }
    if (!editing || headersTouched) {
      const h = Object.fromEntries(headers.filter((x) => x.k && x.v).map((x) => [x.k, x.v]));
      if (editing) body.headers = Object.keys(h).length ? h : null;
      else if (Object.keys(h).length) body.headers = h;
    }
    try {
      const saved = editing
        ? await api<ProviderView>(`/api/admin/providers/${editing.id}`, { method: 'PATCH', body })
        : await api<ProviderView>('/api/admin/providers', { method: 'POST', body });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? `Edit ${editing.name}` : 'Add provider'} description="Keys are encrypted at rest and never shown again after saving." size="lg">
        <form onSubmit={save} className="flex flex-col gap-4">
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={form.type}
                disabled={Boolean(editing)}
                onChange={(e) => {
                  const type = e.target.value as ProviderType;
                  const preset = presets?.presets[type];
                  setForm((f) => ({ ...f, type, baseUrl: preset?.baseUrl ?? f.baseUrl, name: f.name || (preset?.label ?? ''), allowPrivateNetwork: ['ollama', 'vllm', 'lmstudio'].includes(type) && Boolean(presets?.allowPrivate) }));
                }}
              >
                {presets ? Object.entries(presets.presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>) : null}
              </Select>
            </Field>
            <Field label="Name" error={errors.name}><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          </div>
          <Field label="Description" optional><Input value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Base API URL" error={errors.baseUrl} hint={presets?.presets[form.type]?.description}><Input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} required inputMode="url" /></Field>
          {editing && !replacingKey ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span>{editing.keys.length ? <>API key set <code className="text-fg-2">{editing.keys[0]!.keyPreview}</code>{editing.keys.length > 1 ? ` (+${editing.keys.length - 1} more)` : ''}</> : 'No API key'}</span>
              <Button size="sm" variant="secondary" onClick={() => setReplacingKey(true)}>{editing.keys.length ? 'Replace key' : 'Add key'}</Button>
            </div>
          ) : (
            <Field label="API key" optional={keyless} hint={editing ? 'Replaces the first key. Leave empty to keep it.' : undefined}>
              <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyless ? 'Not required for local servers' : 'sk-…'} />
            </Field>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Custom headers <span className="font-normal text-fg-3">(values are encrypted; re-enter to change)</span></legend>
            {headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="Header name" placeholder="Header" value={h.k} onChange={(e) => { setHeadersTouched(true); setHeaders(headers.map((x, j) => (j === i ? { ...x, k: e.target.value } : x))); }} />
                <Input aria-label="Header value" type="password" placeholder={editing ? '•••• (unchanged)' : 'Value'} value={h.v} onChange={(e) => { setHeadersTouched(true); setHeaders(headers.map((x, j) => (j === i ? { ...x, v: e.target.value } : x))); }} />
                <Button variant="ghost" size="icon" aria-label="Remove header" onClick={() => { setHeadersTouched(true); setHeaders(headers.filter((_, j) => j !== i)); }}><Trash2 size={16} aria-hidden="true" /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setHeaders([...headers, { k: '', v: '' }])}><Plus size={14} aria-hidden="true" /> Add header</Button>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Organization" optional><Input value={form.organization} onChange={(e) => set('organization', e.target.value)} /></Field>
            <Field label="Project" optional><Input value={form.project} onChange={(e) => set('project', e.target.value)} /></Field>
            <Field label="Timeout (ms)"><Input type="number" min={1000} max={600000} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} /></Field>
            <Field label="Retries"><Input type="number" min={0} max={5} value={form.maxRetries} onChange={(e) => set('maxRetries', Number(e.target.value))} /></Field>
          </div>
          <Field label="Icon URL" optional hint="Downloaded once, resized and re-hosted. You can also upload a file after saving."><Input value={form.iconUrl} onChange={(e) => set('iconUrl', e.target.value)} inputMode="url" /></Field>
          <SwitchRow label="Enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
          <SwitchRow
            label="Allow private network address"
            description={presets?.allowPrivate ? 'For local servers like Ollama on your LAN. Cloud metadata addresses stay blocked.' : 'Disabled on this server (ALLOW_PRIVATE_PROVIDER_URLS=false).'}
            checked={form.allowPrivateNetwork}
            disabled={!presets?.allowPrivate}
            onCheckedChange={(v) => set('allowPrivateNetwork', v)}
          />
          <Field label="Admin notes" optional><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Add provider'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
