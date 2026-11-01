import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, EmptyState, Field, Select, Skeleton, Textarea, toast } from '@lumen/ui';
import { ImageIcon, Sparkles } from 'lucide-react';
import { errorMessage } from '../../lib/api.js';
import { featureState, useMe } from '../../lib/auth.js';
import { ASPECT_RATIOS, imageApi, useImageModels, useImages } from './api.js';
import { ImageCard } from './ImageCard.js';

export function ImagesPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const list = useImages();
  const models = useImageModels();
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<string>('1:1');
  const [n, setN] = useState(1);
  const [modelId, setModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const feature = featureState(me, 'imageGeneration');
  const available = (models.data ?? []).filter((m) => m.available);
  const refresh = () => qc.invalidateQueries({ queryKey: ['images'] });

  const generate = async () => {
    setBusy(true);
    try {
      await imageApi.generate({ prompt: prompt.trim(), aspectRatio: ratio, n, ...(modelId ? { modelId } : {}) });
      await refresh();
    } catch (e) {
      toast.error('Couldn’t generate', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl overflow-y-auto px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Images</h1>
      {!feature.allowed ? (
        <Banner tone="warning" className="mb-4">Image generation isn’t available for your account{feature.reason === 'EMAIL_UNVERIFIED' ? ' until you verify your email' : ''}.</Banner>
      ) : models.isSuccess && !available.length ? (
        <Banner tone="info" className="mb-4">No image model is set up yet. An administrator can add one (OpenAI images, Stability, Replicate or ComfyUI) under Admin → Providers.</Banner>
      ) : null}
      <form className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) void generate(); }}>
        <Field label="Describe an image">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} placeholder="A watercolor lighthouse at dusk, soft light, wide shot" className="min-h-20" />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Aspect ratio"><Select value={ratio} onChange={(e) => setRatio(e.target.value)} className="w-28">{ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
          <Field label="Images"><Select value={String(n)} onChange={(e) => setN(Number(e.target.value))} className="w-20">{[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field>
          {available.length > 1 ? (
            <Field label="Model"><Select value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-52"><option value="">Default</option>{available.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select></Field>
          ) : null}
          <span className="flex-1" />
          <Button type="submit" loading={busy} disabled={!prompt.trim() || !feature.allowed || !available.length}><Sparkles size={16} aria-hidden="true" /> Generate</Button>
        </div>
      </form>
      {busy ? <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Generating">{Array.from({ length: n }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div> : null}
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="aspect-square" /><Skeleton className="aspect-square" /></div>
      ) : !list.data?.length ? (
        <EmptyState icon={<ImageIcon size={28} />} title="No images yet" description="Describe an image above, or ask for one in any chat." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your images">
          {list.data.map((img) => (
            <li key={img.id}>
              <ImageCard
                img={img}
                onVariations={async () => { await imageApi.variations(img.id, 2); await refresh(); toast.success('Variations added'); }}
                onDelete={async () => { await imageApi.remove(img.id); await refresh(); }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
