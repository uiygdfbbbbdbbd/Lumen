/** Incremental parsers for Server-Sent Events and newline-delimited JSON over fetch bodies. */

export interface SseMessage {
  event: string | null;
  data: string;
  id: string | null;
}

async function* chunks(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Spec-compliant enough for LLM APIs: handles CRLF, multi-line data, comments and split chunks. */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  let buffer = '';
  let event: string | null = null;
  let id: string | null = null;
  let data: string[] = [];
  const flush = (): SseMessage | null => {
    if (data.length === 0) {
      event = null;
      return null;
    }
    const msg = { event, data: data.join('\n'), id };
    event = null;
    data = [];
    return msg;
  };
  for await (const chunk of chunks(body, signal)) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === '\r' && buffer[idx + 1] === '\n' ? 2 : 1));
      if (line === '') {
        const m = flush();
        if (m) yield m;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id') id = value;
    }
  }
  if (buffer) data.push(...(buffer.startsWith('data:') ? [buffer.slice(5).trimStart()] : []));
  const last = flush();
  if (last) yield last;
}

export async function* parseNdjson<T = unknown>(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<T> {
  let buffer = '';
  for await (const chunk of chunks(body, signal)) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

/** Parse tool-call argument JSON; tolerate empty strings and minor model sloppiness. */
export function parseToolArguments(raw: string): Record<string, unknown> {
  const s = raw.trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    // Common failure: trailing commas or truncated output. Report raw so the tool layer can respond with an error.
    return { __raw: s, __parseError: true };
  }
}
