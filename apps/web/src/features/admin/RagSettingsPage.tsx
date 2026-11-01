import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, Field, Input, Select, SwitchRow, toast } from '@lumen/ui';
import { api, errorMessage } from '../../lib/api.js';

interface Rag {
  embeddingModelId: string | null;
  chunkTokens: number;
  overlapTokens: number;
  inlineTokenLimit: number;
  topK: number;
  stripImageMetadata: boolean;
  maxArchiveEntries: number;
  maxArchiveBytes: number;
}

export function RagSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ rag: Rag }>('/api/admin/settings') });
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: () => api<{ items: { id: string; displayName: string; providerModelId: string; enabled: boolean }[] }>('/api/admin/models').then((r) => r.items) });
  const [rag, setRag] = useState<Rag | null>(null);
  useEffect(() => setRag(settings.data?.rag ?? null), [settings.data]);
  if (!rag) return null;
  const set = <K extends keyof Rag>(k: K, v: Rag[K]) => setRag({ ...rag, [k]: v });
  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">Knowledge & RAG</h2>
        <p className="text-sm text-fg-2">How uploaded files are processed and retrieved in chats.</p>
      </header>
      <Card>
        <CardHeader title="Embeddings" description="Semantic search needs an embedding model. Without one, retrieval uses keyword search only." />
        <Field label="Embedding model" hint="Changing it re-embeds new uploads only; re-upload or retry files to re-index existing ones.">
          <Select value={rag.embeddingModelId ?? ''} onChange={(e) => set('embeddingModelId', e.target.value || null)}>
            <option value="">None (keyword search only)</option>
            {models.data?.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.providerModelId})</option>)}
          </Select>
        </Field>
      </Card>
      <Card>
        <CardHeader title="Chunking and retrieval" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Chunk size (tokens)"><Input type="number" min={100} max={4000} value={rag.chunkTokens} onChange={(e) => set('chunkTokens', Number(e.target.value))} /></Field>
          <Field label="Overlap (tokens)"><Input type="number" min={0} max={1000} value={rag.overlapTokens} onChange={(e) => set('overlapTokens', Number(e.target.value))} /></Field>
          <Field label="Inline files up to (tokens)" hint="Smaller attachments are given to the model in full."><Input type="number" min={0} value={rag.inlineTokenLimit} onChange={(e) => set('inlineTokenLimit', Number(e.target.value))} /></Field>
          <Field label="Excerpts per question"><Input type="number" min={1} max={50} value={rag.topK} onChange={(e) => set('topK', Number(e.target.value))} /></Field>
          <Field label="Max archive entries"><Input type="number" min={1} value={rag.maxArchiveEntries} onChange={(e) => set('maxArchiveEntries', Number(e.target.value))} /></Field>
          <Field label="Max archive size (MB)"><Input type="number" min={1} value={Math.round(rag.maxArchiveBytes / 1024 / 1024)} onChange={(e) => set('maxArchiveBytes', Number(e.target.value) * 1024 * 1024)} /></Field>
        </div>
        <SwitchRow label="Strip image metadata (EXIF/GPS)" checked={rag.stripImageMetadata} onCheckedChange={(v) => set('stripImageMetadata', v)} />
        <div className="mt-4 flex justify-end">
          <Button
            onClick={async () => {
              try {
                await api('/api/admin/settings/rag', { method: 'PUT', body: rag });
                await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
                toast.success('Settings saved');
              } catch (e) {
                toast.error('Couldn’t save', errorMessage(e));
              }
            }}
          >
            Save
          </Button>
        </div>
      </Card>
    </>
  );
}
