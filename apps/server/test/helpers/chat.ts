import type { ChatStreamEvent } from '@lumen/shared';
import type { MockProvider } from '@lumen/llm/mock';
import type { TestApp, TestClient } from './app.js';

/** Create an enabled provider pointing at the mock and return model ids by provider model name. */
export async function setupMockModels(t: TestApp, admin: TestClient, mock: MockProvider, apiKey: string, extra: Record<string, unknown> = {}) {
  const p = (await admin.post('/api/admin/providers', { name: `Mock ${Math.random().toString(36).slice(2, 6)}`, type: 'openai', baseUrl: `${mock.url}/v1`, apiKey, allowPrivateNetwork: true, ...extra })).json();
  await admin.post(`/api/admin/providers/${p.id}/import-models`, { enable: true });
  const models = (await admin.get(`/api/admin/models?providerId=${p.id}`)).json().items as { id: string; providerModelId: string }[];
  const ids = Object.fromEntries(models.map((m) => [m.providerModelId, m.id])) as Record<string, string>;
  return { providerId: p.id as string, ids };
}

export function parseSse(body: string): { seq: number; event: ChatStreamEvent }[] {
  return body
    .split('\n\n')
    .map((block) => {
      const id = /^id: (\d+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return id && data ? { seq: Number(id), event: JSON.parse(data) as ChatStreamEvent } : null;
    })
    .filter((x): x is { seq: number; event: ChatStreamEvent } => x !== null);
}

export async function streamEvents(client: TestClient, messageId: string, after = 0) {
  const res = await client.get(`/api/streams/${messageId}${after ? `?after=${after}` : ''}`);
  return parseSse(res.body);
}

export function textOf(events: { event: ChatStreamEvent }[]): string {
  return events.map((e) => (e.event.type === 'text' ? e.event.text : '')).join('');
}

export async function send(client: TestClient, conversationId: string, body: Record<string, unknown>) {
  const res = await client.post(`/api/conversations/${conversationId}/messages`, body);
  return res;
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
