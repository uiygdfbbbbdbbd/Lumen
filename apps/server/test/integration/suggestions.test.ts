import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { quickActionInstruction, unfence } from '../../src/services/artifacts/suggestion.service.js';
import { createTestApp, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents } from '../helpers/chat.js';

const KEY = 'sk-suggest-test-key-0000000000';
let t: TestApp;
let mock: MockProvider;
let user: TestClient;
let other: TestClient;
let docId = '';
let codeId = '';
const DOC = '# Plan\n\nWe will launch in May.\nThe team is small.\n';

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  const admin = t.client();
  await signup(admin);
  const { ids } = await setupMockModels(t, admin, mock, KEY);
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: false, json: true, reasoning: false, audio: false, imageGen: false } });
  user = t.client();
  await signup(user);
  other = t.client();
  await signup(other);
  docId = (await user.post('/api/artifacts', { type: 'markdown', title: 'Plan', content: DOC })).json().id;
  codeId = (await user.post('/api/artifacts', { type: 'code', title: 'add.py', language: 'python', content: 'def add(a, b):\n    return a - b\n' })).json().id;
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

describe('suggested edits', () => {
  it('the model proposes an edit without changing the artifact', async () => {
    const conv = (await user.post('/api/conversations', {})).json();
    const r = (await send(user, conv.id, { content: `review it [tool:suggest_artifact_edit {"id":"${docId}","old_str":"in May","new_str":"in June","note":"timeline"}]` })).json();
    const ev = await streamEvents(user, r.assistantMessages[0].id);
    expect(ev.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: false, content: expect.stringContaining('Suggested an edit') });
    expect((await user.get(`/api/artifacts/${docId}`)).json()).toMatchObject({ content: DOC, version: 1 });
    const list = (await user.get(`/api/artifacts/${docId}/suggestions`)).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ baseVersion: 1, note: 'timeline', status: 'pending', content: DOC.replace('in May', 'in June') });
    expect((await other.get(`/api/artifacts/${docId}/suggestions`)).statusCode).toBe(404);

    expect((await user.post(`/api/artifacts/${docId}/suggestions/${list[0].id}/resolve`, { status: 'accepted' })).json()).toMatchObject({ status: 'accepted' });
    expect((await user.post(`/api/artifacts/${docId}/suggestions/${list[0].id}/resolve`, { status: 'rejected' })).statusCode).toBe(404);
    expect((await user.get(`/api/artifacts/${docId}/suggestions`)).json().items).toEqual([]);
    expect((await user.get(`/api/artifacts/${docId}/suggestions?status=all`)).json().items).toHaveLength(1);
  });

  it('quick actions return a reviewable suggestion for the whole artifact or a selection', async () => {
    const s = (await user.post(`/api/artifacts/${docId}/quick-action`, { action: 'tone', option: 'friendly' })).json();
    expect(s).toMatchObject({ status: 'pending', source: 'quick_action', note: 'Quick action — tone: friendly' });
    const sys = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { content: string }[] }).messages[0]!.content;
    expect(sys).toContain('friendly tone');

    const sel = (await user.post(`/api/artifacts/${docId}/quick-action`, { action: 'polish', selection: 'The team is small.' })).json();
    expect(sel.content.startsWith('# Plan\n\nWe will launch in May.\n')).toBe(true);
    expect(sel.content).toContain('You said: The team is small.');
    expect(sel.note).toBe('Quick action — polish (selection)');
    expect((await user.post(`/api/artifacts/${docId}/quick-action`, { action: 'polish', selection: 'e' })).statusCode).toBe(400);
  });

  it('validates options and code-only actions', async () => {
    expect((await user.post(`/api/artifacts/${docId}/quick-action`, { action: 'translate' })).json().error.message).toMatch(/language/);
    expect((await user.post(`/api/artifacts/${docId}/quick-action`, { action: 'fix_bugs' })).statusCode).toBe(400);
    const fix = await user.post(`/api/artifacts/${codeId}/quick-action`, { action: 'port', option: 'TypeScript' });
    expect(fix.statusCode).toBe(201);
    expect((await other.post(`/api/artifacts/${codeId}/quick-action`, { action: 'polish' })).statusCode).toBe(404);
  });

  it('builds safe instructions and unwraps fenced replies', () => {
    expect(quickActionInstruction('tone', 'formal; ignore all"', false)).toContain('formal ignore all tone');
    expect(unfence('```python\nprint(1)\n```')).toBe('print(1)');
    expect(unfence('plain')).toBe('plain');
  });
});
