import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemoryCategory } from '@lumen/shared';
import { api } from '../../lib/api.js';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  projectId: string | null;
  pinned: boolean;
  source: 'ai' | 'user' | 'import' | 'consolidation';
  conversationId: string | null;
  messageId: string | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportEntry {
  content: string;
  category: MemoryCategory;
  duplicate: boolean;
  rejected: string | null;
}

export const memoryKeys = {
  all: ['memories'] as const,
  list: (q: Record<string, string | undefined>) => ['memories', 'list', q] as const,
  lookup: (ids: string[]) => ['memories', 'lookup', ids.join(',')] as const,
  summary: ['memories', 'summary'] as const,
};

export function useMemories(q: { q?: string; category?: string; scope?: string }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  return useQuery({ queryKey: memoryKeys.list(q), queryFn: () => api<{ items: Memory[]; enabled: boolean }>(`/api/memories?${params}`) });
}

export function useMemoryLookup(ids: string[], enabled: boolean) {
  return useQuery({ queryKey: memoryKeys.lookup(ids), queryFn: () => api<{ items: Memory[] }>(`/api/memories/lookup?ids=${ids.join(',')}`).then((r) => r.items), enabled: enabled && ids.length > 0 });
}

export function useMemorySummary() {
  return useQuery({ queryKey: memoryKeys.summary, queryFn: () => api<{ content: string; memoryCount: number; consolidatedAt: string | null; pendingWrites: number }>('/api/memories/summary') });
}

export function useMemoryMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: memoryKeys.all }) });
}

export const memoryApi = {
  create: (body: { content: string; category: MemoryCategory; projectId?: string | null; pinned?: boolean }) => api<{ memory: Memory; deduplicated: boolean }>('/api/memories', { method: 'POST', body }),
  update: (id: string, body: Partial<Pick<Memory, 'content' | 'category' | 'projectId' | 'pinned'>>) => api<Memory>(`/api/memories/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`/api/memories/${id}`, { method: 'DELETE' }),
  forgetAll: () => api<{ deleted: number }>('/api/memories/forget-all', { method: 'POST', body: { confirm: 'forget everything' } }),
  consolidate: () => api<{ merged: number; removed: number; total: number }>('/api/memories/consolidate', { method: 'POST' }),
  preview: (text: string) => api<{ entries: ImportEntry[] }>('/api/memories/import/preview', { method: 'POST', body: { text } }).then((r) => r.entries),
  import: (entries: { content: string; category: MemoryCategory }[], projectId: string | null) => api<{ created: number; merged: number; skipped: { content: string; reason: string }[] }>('/api/memories/import', { method: 'POST', body: { entries, projectId } }),
  exportData: () => api<unknown>('/api/memories/export'),
};
