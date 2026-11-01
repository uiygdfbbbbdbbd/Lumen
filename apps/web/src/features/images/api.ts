import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

export interface GeneratedImage {
  id: string;
  fileId: string;
  url: string;
  prompt: string;
  revisedPrompt: string | null;
  aspectRatio: string;
  modelName: string | null;
  seed: number | null;
  variationOf: string | null;
  conversationId: string | null;
  createdAt: string;
}

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
export const ratioClass: Record<string, string> = { '1:1': 'aspect-square', '16:9': 'aspect-video', '9:16': 'aspect-[9/16]', '4:3': 'aspect-[4/3]', '3:4': 'aspect-[3/4]', '3:2': 'aspect-[3/2]', '2:3': 'aspect-[2/3]' };

export const imageApi = {
  generate: (body: { prompt: string; aspectRatio: string; n: number; modelId?: string }) => api<{ items: GeneratedImage[] }>('/api/images', { method: 'POST', body }).then((r) => r.items),
  variations: (id: string, n = 2) => api<{ items: GeneratedImage[] }>(`/api/images/${id}/variations`, { method: 'POST', body: { n } }).then((r) => r.items),
  remove: (id: string) => api(`/api/images/${id}`, { method: 'DELETE' }),
};

export function useImages(ids?: string[]) {
  return useQuery({
    queryKey: ['images', ids?.join(',') ?? 'all'],
    queryFn: () => api<{ items: GeneratedImage[] }>(`/api/images${ids ? `?ids=${ids.join(',')}` : ''}`).then((r) => r.items),
    enabled: !ids || ids.length > 0,
  });
}

export function useImageModels() {
  return useQuery({ queryKey: ['image-models'], queryFn: () => api<{ items: { id: string; displayName: string; available: boolean }[] }>('/api/images/models').then((r) => r.items), staleTime: 60_000 });
}
