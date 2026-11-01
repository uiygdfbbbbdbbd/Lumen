import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@lumen/shared';
import { convKeys } from './api.js';

/** Keep chat lists and open conversations in sync across tabs and devices. Reconnects with backoff. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (msg) => {
        const e = JSON.parse(String(msg.data)) as RealtimeEvent;
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        if ('conversationId' in e && e.type !== 'conversation.deleted') void qc.invalidateQueries({ queryKey: convKeys.tree(e.conversationId) });
      };
      ws.onclose = (ev) => {
        if (stopped || ev.code === 4401 || ev.code === 4403) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, qc]);
}
