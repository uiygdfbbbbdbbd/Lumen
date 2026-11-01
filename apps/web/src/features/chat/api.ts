import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ChatMessage, ConversationSummary, ConversationTree } from './types.js';

export const convKeys = {
  list: (archived = false) => ['conversations', { archived }] as const,
  tree: (id: string) => ['conversation', id] as const,
};

export function useConversationList(archived = false) {
  return useInfiniteQuery({
    queryKey: convKeys.list(archived),
    queryFn: ({ pageParam }) =>
      api<{ items: ConversationSummary[]; nextCursor: string | null }>(`/api/conversations?limit=50${archived ? '&archived=true' : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({ queryKey: convKeys.tree(id ?? ''), queryFn: () => api<ConversationTree>(`/api/conversations/${id}`), enabled: Boolean(id), staleTime: 5_000 });
}

export interface SendResult {
  userMessage: ChatMessage;
  assistantMessages: ChatMessage[];
}

export function createConversation(body: { title?: string; modelId?: string | null; incognito?: boolean; instructions?: string; settings?: Record<string, unknown>; projectId?: string | null }) {
  return api<ConversationSummary>('/api/conversations', { method: 'POST', body });
}

export function sendMessage(conversationId: string, body: { content: string; parentId?: string | null; modelId?: string; compareModelIds?: string[]; thinkingEffort?: string; attachments?: string[] }) {
  return api<SendResult>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body });
}

export function useInvalidateChat() {
  const qc = useQueryClient();
  return (conversationId?: string) =>
    Promise.all([qc.invalidateQueries({ queryKey: ['conversations'] }), conversationId ? qc.invalidateQueries({ queryKey: convKeys.tree(conversationId) }) : null]);
}

export function usePatchConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api<ConversationSummary>(`/api/conversations/${id}`, { method: 'PATCH', body }),
    onSuccess: (_d, v) => Promise.all([qc.invalidateQueries({ queryKey: ['conversations'] }), qc.invalidateQueries({ queryKey: convKeys.tree(v.id) })]),
  });
}

export interface SearchHit {
  conversationId: string;
  title: string;
  messageId: string;
  role: string;
  snippet: string;
  lastMessageAt: string;
}

export function searchConversations(q: string, signal?: AbortSignal) {
  return api<{ items: SearchHit[] }>(`/api/conversations/search?q=${encodeURIComponent(q)}&limit=20`, { signal }).then((r) => r.items);
}
