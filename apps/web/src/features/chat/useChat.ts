import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LumenError } from '@lumen/shared';
import { toast } from '@lumen/ui';
import { api, errorMessage } from '../../lib/api.js';
import { convKeys, createConversation, sendMessage, useConversation, type SendResult } from './api.js';
import { followStream } from './stream.js';
import { useStreams } from './store.js';
import { indexTree } from './tree.js';
import type { ChatMessage } from './types.js';

const QUEUE_KEY = 'lumen.offlineQueue';

interface QueuedSend {
  conversationId: string;
  content: string;
  modelId?: string;
}

/** Follows every in-flight generation of a conversation; re-attaches automatically after reloads. */
function useFollowStreaming(conversationId: string | undefined, messages: ChatMessage[] | undefined) {
  const qc = useQueryClient();
  const following = useRef(new Map<string, AbortController>());
  const apply = useStreams((s) => s.apply);
  const setReconnecting = useStreams((s) => s.setReconnecting);
  const clear = useStreams((s) => s.clear);

  const follow = useCallback(
    (messageId: string) => {
      if (following.current.has(messageId)) return;
      const ctrl = new AbortController();
      following.current.set(messageId, ctrl);
      void followStream(
        messageId,
        {
          onEvent: (e) => {
            apply(messageId, e);
            if (e.type === 'done' || e.type === 'error') {
              void (async () => {
                if (conversationId) await qc.invalidateQueries({ queryKey: convKeys.tree(conversationId) });
                await qc.invalidateQueries({ queryKey: ['conversations'] });
                await qc.invalidateQueries({ queryKey: ['usage'] });
                clear(messageId);
              })();
            }
          },
          onReconnecting: () => setReconnecting(messageId, true),
        },
        ctrl.signal,
      ).finally(() => following.current.delete(messageId));
    },
    [apply, clear, conversationId, qc, setReconnecting],
  );

  useEffect(() => {
    for (const m of messages ?? []) if (m.status === 'streaming') follow(m.id);
  }, [messages, follow]);

  useEffect(() => {
    const map = following.current;
    return () => {
      for (const c of map.values()) c.abort();
      map.clear();
    };
  }, [conversationId]);

  return follow;
}

export function useChat(conversationId: string | undefined) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tree = useConversation(conversationId);
  const follow = useFollowStreaming(conversationId, tree.data?.messages);
  const idx = useMemo(() => indexTree(tree.data?.messages ?? []), [tree.data?.messages]);

  const afterSend = useCallback(
    async (convId: string, r: SendResult | { assistantMessage: ChatMessage }) => {
      const assistants = 'assistantMessages' in r ? r.assistantMessages : [r.assistantMessage];
      await qc.invalidateQueries({ queryKey: convKeys.tree(convId) });
      for (const a of assistants) follow(a.id);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    [follow, qc],
  );

  const send = useCallback(
    async (content: string, opts: { modelId?: string; compareModelIds?: string[]; incognito?: boolean; parentId?: string | null; attachments?: string[]; projectId?: string | null } = {}) => {
      let convId = conversationId;
      if (!navigator.onLine) {
        if (!convId) throw new LumenError('PROVIDER_UNAVAILABLE', 'You are offline.');
        const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedSend[];
        q.push({ conversationId: convId, content, modelId: opts.modelId });
        localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
        toast({ title: 'You’re offline', description: 'Your message will be sent when you reconnect.' });
        return;
      }
      if (!convId) {
        const c = await createConversation({ modelId: opts.compareModelIds ? null : (opts.modelId ?? null), incognito: opts.incognito ?? false, projectId: opts.projectId ?? null });
        convId = c.id;
        const r = await sendMessage(convId, { content, ...(opts.modelId && !opts.compareModelIds ? { modelId: opts.modelId } : {}), ...(opts.compareModelIds ? { compareModelIds: opts.compareModelIds } : {}), ...(opts.attachments ? { attachments: opts.attachments } : {}) });
        await navigate({ to: '/c/$conversationId', params: { conversationId: convId } });
        await afterSend(convId, r);
        return;
      }
      const r = await sendMessage(convId, { content, ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}), ...(opts.modelId && !opts.compareModelIds ? { modelId: opts.modelId } : {}), ...(opts.compareModelIds ? { compareModelIds: opts.compareModelIds } : {}), ...(opts.attachments ? { attachments: opts.attachments } : {}) });
      await afterSend(convId, r);
    },
    [afterSend, conversationId, navigate],
  );

  const regenerate = useCallback(
    async (messageId: string, modelId?: string) => {
      if (!conversationId) return;
      const r = await api<{ assistantMessage: ChatMessage }>(`/api/conversations/${conversationId}/messages/${messageId}/regenerate`, { method: 'POST', body: modelId ? { modelId } : {} });
      await afterSend(conversationId, r);
    },
    [afterSend, conversationId],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      if (!conversationId) return;
      const r = await api<SendResult>(`/api/conversations/${conversationId}/messages/${messageId}/edit`, { method: 'POST', body: { content } });
      await afterSend(conversationId, r);
    },
    [afterSend, conversationId],
  );

  const cancel = useCallback(async (messageId: string) => {
    await api(`/api/streams/${messageId}/cancel`, { method: 'POST' }).catch(() => undefined);
  }, []);

  const switchTo = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      await api(`/api/conversations/${conversationId}`, { method: 'PATCH', body: { activeLeafId: messageId } });
      await qc.invalidateQueries({ queryKey: convKeys.tree(conversationId) });
    },
    [conversationId, qc],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      await api(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: convKeys.tree(conversationId) });
    },
    [conversationId, qc],
  );

  const rate = useCallback(
    async (messageId: string, rating: -1 | 0 | 1, reason?: string) => {
      if (!conversationId) return;
      await api(`/api/conversations/${conversationId}/messages/${messageId}/feedback`, { method: 'POST', body: { rating, reason } });
      await qc.invalidateQueries({ queryKey: convKeys.tree(conversationId) });
    },
    [conversationId, qc],
  );

  // Flush messages queued while offline.
  useEffect(() => {
    const flush = async () => {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedSend[];
      if (!q.length) return;
      localStorage.removeItem(QUEUE_KEY);
      for (const item of q) {
        try {
          const r = await sendMessage(item.conversationId, { content: item.content, ...(item.modelId ? { modelId: item.modelId } : {}) });
          if (item.conversationId === conversationId) await afterSend(item.conversationId, r);
        } catch (e) {
          toast.error('A queued message could not be sent', errorMessage(e));
        }
      }
    };
    window.addEventListener('online', flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener('online', flush);
  }, [afterSend, conversationId]);

  const path = useMemo(() => (tree.data?.activePath ?? []).map((id) => idx.byId.get(id)).filter((m): m is ChatMessage => Boolean(m)), [tree.data?.activePath, idx]);

  return { tree, idx, path, send, regenerate, edit, cancel, switchTo, remove, rate };
}
