import type { ChatStreamEvent } from '@lumen/shared';

export interface StreamHandlers {
  onEvent: (e: ChatStreamEvent, seq: number) => void;
  onReconnecting?: (attempt: number) => void;
}

/**
 * Follow a generation's SSE stream. If the connection drops (network blip, laptop sleep, server restart),
 * reconnect with backoff and resume from the last sequence number — no tokens are lost or duplicated.
 */
export async function followStream(messageId: string, h: StreamHandlers, signal: AbortSignal): Promise<void> {
  let lastSeq = 0;
  let attempt = 0;
  for (;;) {
    if (signal.aborted) return;
    let finished = false;
    try {
      const res = await fetch(`/api/streams/${messageId}`, {
        headers: { accept: 'text/event-stream', ...(lastSeq ? { 'last-event-id': String(lastSeq) } : {}) },
        credentials: 'include',
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const id = /^id: (\d+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!data) continue;
          const seq = id ? Number(id) : lastSeq + 1;
          if (seq <= lastSeq) continue;
          lastSeq = seq;
          const event = JSON.parse(data) as ChatStreamEvent;
          h.onEvent(event, seq);
          if (event.type === 'done' || event.type === 'error') finished = true;
        }
      }
      if (finished) return;
    } catch (err) {
      if (signal.aborted || (err as Error).name === 'AbortError') return;
    }
    if (finished) return;
    attempt += 1;
    if (attempt > 20) {
      h.onEvent({ type: 'error', code: 'PROVIDER_UNAVAILABLE', message: 'Lost connection to the server.', retryable: true }, lastSeq + 1);
      return;
    }
    h.onReconnecting?.(attempt);
    await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5))));
  }
}
