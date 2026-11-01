import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { plan, type NormalizedTurn, type Plan } from './script.js';

export interface MockProvider {
  url: string;
  port: number;
  requests: { path: string; headers: http.IncomingHttpHeaders; body: unknown }[];
  close(): Promise<void>;
}

export const MOCK_MODELS = [
  { id: 'mock-fast', name: 'Mock Fast', context: 32000 },
  { id: 'mock-smart', name: 'Mock Smart', context: 200000 },
  { id: 'mock-vision', name: 'Mock Vision', context: 128000 },
  { id: 'mock-reasoning', name: 'Mock Reasoning', context: 128000 },
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- wire formats of five providers

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: Json) => p.text ?? (typeof p.content === 'string' ? p.content : '')).join(' ');
  return '';
}

function normalize(kind: string, body: Json): NormalizedTurn {
  let lastUserText = '';
  let toolResult: NormalizedTurn['toolResult'] = null;
  const totalChars = JSON.stringify(body).length;
  if (kind === 'gemini') {
    const contents = (body.contents ?? []) as Json[];
    const last = contents[contents.length - 1];
    const fr = last?.parts?.find((p: Json) => p.functionResponse);
    if (fr) toolResult = { name: fr.functionResponse.name, content: String(fr.functionResponse.response?.content ?? JSON.stringify(fr.functionResponse.response)) };
    for (const c of contents) if (c.role === 'user') for (const p of c.parts ?? []) if (p.text) lastUserText = p.text;
    return { lastUserText, toolResult, totalChars };
  }
  const msgs = (body.messages ?? []) as Json[];
  const last = msgs[msgs.length - 1];
  if (kind === 'anthropic') {
    const tr = Array.isArray(last?.content) ? last.content.find((b: Json) => b.type === 'tool_result') : null;
    if (tr) {
      const prev = msgs[msgs.length - 2];
      const use = prev?.content?.find?.((b: Json) => b.type === 'tool_use' && b.id === tr.tool_use_id);
      toolResult = { name: use?.name ?? 'tool', content: textOf(tr.content) };
    }
    for (const m of msgs) if (m.role === 'user') { const t = textOf(m.content); if (t.trim()) lastUserText = t; }
  } else {
    if (last?.role === 'tool') {
      const name = last.tool_name ?? msgs.flatMap((m) => m.tool_calls ?? []).find((c: Json) => c.id === last.tool_call_id)?.function?.name ?? 'tool';
      toolResult = { name, content: textOf(last.content) };
    }
    for (const m of msgs) if (m.role === 'user') lastUserText = textOf(m.content);
  }
  return { lastUserText, toolResult, totalChars };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorBody(kind: string, status: number) {
  const message = status === 429 ? 'Rate limit exceeded (mock)' : status === 401 ? 'Invalid API key (mock)' : `Mock failure ${status}`;
  if (kind === 'anthropic') return { type: 'error', error: { type: status === 429 ? 'rate_limit_error' : 'api_error', message } };
  if (kind === 'gemini') return { error: { code: status, message, status: 'ERROR' } };
  if (kind === 'ollama') return { error: message };
  return { error: { message, type: 'mock_error', code: status } };
}

async function emit(res: ServerResponse, kind: string, model: string, p: Plan) {
  const sse = kind !== 'ollama';
  res.writeHead(200, { 'content-type': sse ? 'text/event-stream' : 'application/x-ndjson', 'cache-control': 'no-cache' });
  const send = (obj: unknown, event?: string) => res.write(sse ? `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(obj)}\n\n` : `${JSON.stringify(obj)}\n`);
  const outTokens = p.words.length + (p.toolCall ? 10 : 0) + (p.reasoning ? 12 : 0);
  let sent = 0;
  const tick = async () => {
    sent += 1;
    if (p.disconnectAfter !== null && sent > p.disconnectAfter) {
      res.socket?.destroy();
      return false;
    }
    if (p.delayMs) await sleep(p.delayMs);
    return true;
  };

  if (kind === 'openai') {
    const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model };
    if (p.reasoning) send({ ...base, choices: [{ index: 0, delta: { reasoning_content: p.reasoning } }] });
    for (const w of p.words) { if (!(await tick())) return; send({ ...base, choices: [{ index: 0, delta: { content: w } }] }); }
    if (p.toolCall) {
      const args = JSON.stringify(p.toolCall.arguments);
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: p.toolCall.name, arguments: '' } }] } }] });
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, Math.ceil(args.length / 2)) } }] } }] });
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(Math.ceil(args.length / 2)) } }] } }] });
    }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: p.toolCall ? 'tool_calls' : 'stop' }] });
    send({ ...base, choices: [], usage: { prompt_tokens: p.inputTokens, completion_tokens: outTokens, total_tokens: p.inputTokens + outTokens } });
    res.write('data: [DONE]\n\n');
  } else if (kind === 'anthropic') {
    send({ type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: p.inputTokens, output_tokens: 1 } } }, 'message_start');
    let idx = 0;
    if (p.reasoning) {
      send({ type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } }, 'content_block_start');
      send({ type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: p.reasoning } }, 'content_block_delta');
      send({ type: 'content_block_stop', index: idx++ }, 'content_block_stop');
    }
    if (p.words.length) {
      send({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }, 'content_block_start');
      for (const w of p.words) { if (!(await tick())) return; send({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: w } }, 'content_block_delta'); }
      send({ type: 'content_block_stop', index: idx++ }, 'content_block_stop');
    }
    if (p.toolCall) {
      const args = JSON.stringify(p.toolCall.arguments);
      send({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: 'toolu_mock_1', name: p.toolCall.name, input: {} } }, 'content_block_start');
      send({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: args } }, 'content_block_delta');
      send({ type: 'content_block_stop', index: idx++ }, 'content_block_stop');
    }
    send({ type: 'message_delta', delta: { stop_reason: p.toolCall ? 'tool_use' : 'end_turn' }, usage: { output_tokens: outTokens } }, 'message_delta');
    send({ type: 'message_stop' }, 'message_stop');
  } else if (kind === 'gemini') {
    if (p.reasoning) send({ candidates: [{ content: { role: 'model', parts: [{ text: p.reasoning, thought: true }] } }] });
    for (const w of p.words) { if (!(await tick())) return; send({ candidates: [{ content: { role: 'model', parts: [{ text: w }] } }] }); }
    if (p.toolCall) send({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: p.toolCall.name, args: p.toolCall.arguments } }] } }] });
    send({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: p.inputTokens, candidatesTokenCount: outTokens } });
  } else if (kind === 'ollama') {
    if (p.reasoning) send({ model, message: { role: 'assistant', content: '', thinking: p.reasoning }, done: false });
    for (const w of p.words) { if (!(await tick())) return; send({ model, message: { role: 'assistant', content: w }, done: false }); }
    if (p.toolCall) send({ model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: p.toolCall.name, arguments: p.toolCall.arguments } }] }, done: false });
    send({ model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: p.inputTokens, eval_count: outTokens });
  } else {
    send({ type: 'message-start', id: 'mock' });
    for (const w of p.words) { if (!(await tick())) return; send({ type: 'content-delta', index: 0, delta: { message: { content: { text: w } } } }); }
    if (p.toolCall) {
      send({ type: 'tool-call-start', index: 0, delta: { message: { tool_calls: { id: 'call_mock_1', type: 'function', function: { name: p.toolCall.name, arguments: '' } } } } });
      send({ type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: JSON.stringify(p.toolCall.arguments) } } } } });
      send({ type: 'tool-call-end', index: 0 });
    }
    send({ type: 'message-end', delta: { finish_reason: p.toolCall ? 'TOOL_CALL' : 'COMPLETE', usage: { billed_units: { input_tokens: p.inputTokens, output_tokens: outTokens } } } });
  }
  res.end();
}

function authorized(req: IncomingMessage, key: string | undefined): boolean {
  if (!key) return true;
  const h = req.headers;
  const bearer = h.authorization?.replace(/^Bearer\s+/i, '');
  return bearer === key || h['x-api-key'] === key || h['x-goog-api-key'] === key;
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Json) : {};
}

export async function startMockProvider(opts: { port?: number; host?: string; apiKey?: string } = {}): Promise<MockProvider> {
  const requests: MockProvider['requests'] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://mock');
      const path = url.pathname;
      const body = req.method === 'POST' ? await readBody(req) : {};
      requests.push({ path: path + url.search, headers: req.headers, body });
      const json = (status: number, obj: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const kind =
        path.startsWith('/api/') ? 'ollama' : path.startsWith('/v1beta/') ? 'gemini' : path.startsWith('/v2/') || url.searchParams.get('endpoint') === 'chat' ? 'cohere' : req.headers['anthropic-version'] ? 'anthropic' : 'openai';
      if (!authorized(req, opts.apiKey)) return json(401, errorBody(kind, 401));

      if (req.method === 'GET') {
        if (path === '/api/tags') return json(200, { models: MOCK_MODELS.map((m) => ({ name: m.id })) });
        if (path === '/v1beta/models') return json(200, { models: MOCK_MODELS.map((m) => ({ name: `models/${m.id}`, displayName: m.name, inputTokenLimit: m.context, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'] })) });
        if (kind === 'cohere') return json(200, { models: MOCK_MODELS.map((m) => ({ name: m.id, context_length: m.context })) });
        if (path === '/v1/models' || path === '/models') {
          return json(200, kind === 'anthropic' ? { data: MOCK_MODELS.map((m) => ({ id: m.id, display_name: m.name, type: 'model' })) } : { object: 'list', data: MOCK_MODELS.map((m) => ({ id: m.id, object: 'model', context_length: m.context })) });
        }
        return json(404, { error: { message: 'not found' } });
      }

      let model = String(body.model ?? '');
      if (kind === 'gemini') model = decodeURIComponent(path.split('/models/')[1]?.split(':')[0] ?? '');
      if (!MOCK_MODELS.some((m) => m.id === model)) return json(404, errorBody(kind, 404));
      const p = plan(normalize(kind, body));
      if (p.errorStatus) return json(p.errorStatus, errorBody(kind, p.errorStatus));
      await emit(res, kind, model, p);
    })().catch((err: Error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
