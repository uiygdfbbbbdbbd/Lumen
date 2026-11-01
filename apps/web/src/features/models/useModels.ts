import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelSummary, UserPreferences } from '@lumen/shared';
import { api } from '../../lib/api.js';

export function useModels() {
  return useQuery({ queryKey: ['models'], queryFn: () => api<{ items: ModelSummary[] }>('/api/models').then((r) => r.items), staleTime: 60_000 });
}

export function usePreferences() {
  return useQuery({ queryKey: ['preferences'], queryFn: () => api<UserPreferences>('/api/me/preferences'), staleTime: 60_000 });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) => api<UserPreferences>('/api/me/preferences', { method: 'PATCH', body: patch }),
    // Refetch rather than trusting each response: with several PATCHes in flight, responses can arrive
    // out of order and an older snapshot would overwrite a newer one.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['preferences'] });
      qc.setQueryData<UserPreferences>(['preferences'], (old) => ({ ...(old ?? {}), ...patch }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['preferences'] }),
  });
}

export const LOCK_TEXT: Record<NonNullable<ModelSummary['lockedReason']>, string> = {
  EMAIL_UNVERIFIED: 'Verify email to unlock',
  ADMINS_ONLY: 'Admins only',
  BETA_ONLY: 'Beta testers only',
  PROVIDER_DOWN: 'Provider unavailable',
};

export function formatContext(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}K`;
}

/** Filter by free text across name, provider, description, tags and aliases. */
export function filterModels(models: ModelSummary[], q: string): ModelSummary[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return models;
  return models.filter((m) => {
    const hay = [m.displayName, m.providerName, m.description, ...m.tags, ...m.aliases].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
