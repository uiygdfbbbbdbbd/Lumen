import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, Dialog, DialogContent, Field, IconButton, Input, Select, Textarea, toast } from '@lumen/ui';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { usePreferences, useUpdatePreferences } from '../models/useModels.js';

interface StylesResponse {
  builtin: { id: string; name: string; instructions: string }[];
  custom: { id: string; name: string; description: string; instructions: string }[];
}

export function StylesCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['styles'], queryFn: () => api<StylesResponse>('/api/styles') });
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const [mode, setMode] = useState<'manual' | 'sample' | null>(null);
  const [form, setForm] = useState({ name: '', instructions: '', sample: '' });
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['styles'] });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'sample') await api('/api/styles/from-sample', { method: 'POST', body: { name: form.name, sample: form.sample } });
      else await api('/api/styles', { method: 'POST', body: { name: form.name, instructions: form.instructions } });
      await refresh();
      setMode(null);
      setForm({ name: '', instructions: '', sample: '' });
      toast.success('Style saved');
    } catch (err) {
      toast.error('Could not save style', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Response styles"
        description="Pick a default tone for new chats, or create your own."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('sample')}><Wand2 size={14} aria-hidden="true" /> From my writing</Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('manual')}><Plus size={14} aria-hidden="true" /> New style</Button>
          </div>
        }
      />
      <Field label="Default style" className="max-w-sm">
        <Select value={prefs?.defaultStyle ?? 'normal'} onChange={(e) => update.mutate({ defaultStyle: e.target.value }, { onSuccess: () => toast.success('Saved') })}>
          {data?.builtin.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {data?.custom.length ? <optgroup label="Your styles">{data.custom.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null}
        </Select>
      </Field>
      {data?.custom.length ? (
        <ul className="mt-4 divide-y divide-border">
          {data.custom.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.name}</div>
                <p className="line-clamp-2 text-xs text-fg-2">{s.instructions}</p>
              </div>
              <IconButton label={`Delete style ${s.name}`} icon={<Trash2 size={16} />} onClick={async () => { await api(`/api/styles/${s.id}`, { method: 'DELETE' }); await refresh(); }} />
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent title={mode === 'sample' ? 'Create a style from your writing' : 'New response style'} description={mode === 'sample' ? 'Paste a few paragraphs you wrote. We’ll describe the style so responses can match it.' : 'Describe how responses should sound.'}>
          <form className="flex flex-col gap-4" onSubmit={create}>
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} /></Field>
            {mode === 'sample' ? (
              <Field label="Writing sample" hint="At least 50 characters."><Textarea value={form.sample} onChange={(e) => setForm({ ...form, sample: e.target.value })} className="min-h-40" required minLength={50} /></Field>
            ) : (
              <Field label="Instructions"><Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="min-h-32" required maxLength={4000} /></Field>
            )}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button><Button type="submit" loading={busy}>Save style</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
