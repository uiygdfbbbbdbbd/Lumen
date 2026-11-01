import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { Artifact, ArtifactSummary, ArtifactVersion } from './types.js';

export const artifactKeys = {
  all: ['artifacts'] as const,
  one: (id: string, version?: number) => ['artifacts', 'one', id, version ?? 'latest'] as const,
  versions: (id: string) => ['artifacts', 'versions', id] as const,
  conversation: (id: string) => ['artifacts', 'conversation', id] as const,
  list: (q: Record<string, string | undefined>) => ['artifacts', 'list', q] as const,
};

export function useArtifact(id: string | null, version?: number) {
  return useQuery({
    queryKey: artifactKeys.one(id ?? '', version),
    queryFn: () => api<Artifact>(`/api/artifacts/${id}${version ? `?version=${version}` : ''}`),
    enabled: Boolean(id),
    staleTime: version ? Infinity : 5_000,
  });
}

export function useArtifactVersions(id: string | null) {
  return useQuery({ queryKey: artifactKeys.versions(id ?? ''), queryFn: () => api<{ items: ArtifactVersion[] }>(`/api/artifacts/${id}/versions`).then((r) => r.items), enabled: Boolean(id) });
}

export function useConversationArtifacts(conversationId: string | undefined) {
  return useQuery({
    queryKey: artifactKeys.conversation(conversationId ?? ''),
    queryFn: () => api<{ items: ArtifactSummary[] }>(`/api/conversations/${conversationId}/artifacts`).then((r) => r.items),
    enabled: Boolean(conversationId),
  });
}

export function useArtifactList(q: { type?: string; q?: string }) {
  const params = new URLSearchParams();
  if (q.type) params.set('type', q.type);
  if (q.q) params.set('q', q.q);
  return useQuery({ queryKey: artifactKeys.list(q), queryFn: () => api<{ items: ArtifactSummary[] }>(`/api/artifacts?${params}`).then((r) => r.items) });
}

/** Any change creates a new version (or changes metadata): refresh every artifact query. */
export function useArtifactMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: artifactKeys.all }) });
}

export const artifactApi = {
  saveVersion: (id: string, content: string, basedOn?: number, label?: string | null) => api<ArtifactSummary>(`/api/artifacts/${id}/versions`, { method: 'POST', body: { content, basedOn, label } }),
  restore: (id: string, version: number) => api<ArtifactSummary>(`/api/artifacts/${id}/versions/${version}/restore`, { method: 'POST' }),
  label: (id: string, version: number, label: string | null) => api(`/api/artifacts/${id}/versions/${version}`, { method: 'PATCH', body: { label } }),
  patch: (id: string, body: { title?: string; projectId?: string | null }) => api<ArtifactSummary>(`/api/artifacts/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`/api/artifacts/${id}`, { method: 'DELETE' }),
  fork: (id: string) => api<ArtifactSummary>(`/api/artifacts/${id}/fork`, { method: 'POST' }),
  forkPublic: (slug: string) => api<ArtifactSummary>(`/api/public/artifacts/${slug}/fork`, { method: 'POST' }),
  publish: (id: string) => api<ArtifactSummary>(`/api/artifacts/${id}/publish`, { method: 'POST' }),
  unpublish: (id: string) => api<ArtifactSummary>(`/api/artifacts/${id}/unpublish`, { method: 'POST' }),
  diff: (id: string, from: number, to: number) => api<{ patch: string }>(`/api/artifacts/${id}/diff?from=${from}&to=${to}`).then((r) => r.patch),
  exportFile: (id: string, format: 'docx' | 'pptx', version?: number) => api<Blob>(`/api/artifacts/${id}/export?format=${format}${version ? `&version=${version}` : ''}`),
};
