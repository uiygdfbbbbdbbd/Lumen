import { errorKindForStatus, LlmError, type ProviderConfig } from './types.js';

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function retryAfterMs(res: Response): number | undefined {
  const ra = res.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return secs * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const ms = res.headers.get('retry-after-ms');
  return ms && Number.isFinite(Number(ms)) ? Number(ms) : undefined;
}

/** Pull a human-readable message out of the many provider error shapes, never echoing secrets. */
export function extractErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = (j.error ?? j) as Record<string, unknown> | string;
    if (typeof e === 'string') return e.slice(0, 500);
    const msg = e.message ?? e.msg ?? j.message ?? j.detail;
    if (typeof msg === 'string') return msg.slice(0, 500);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300) || 'no details';
}

export async function request(cfg: ProviderConfig, url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const f = cfg.fetch ?? fetch;
  const timeout = AbortSignal.timeout(cfg.timeoutMs ?? 120_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await f(url, { ...init, signal });
  } catch (err) {
    const e = err as Error;
    if (init.signal?.aborted) throw e;
    if (e.name === 'TimeoutError' || timeout.aborted) throw new LlmError('timeout', 'The model provider took too long to respond.');
    throw new LlmError('network', `Could not reach the model provider: ${e.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const kind = errorKindForStatus(res.status);
    const msg = extractErrorMessage(body);
    const finalKind = kind === 'rate_limit' && /quota|billing|insufficient/i.test(msg) ? 'quota' : kind;
    throw new LlmError(finalKind, `Provider error ${res.status}: ${msg}`, res.status, retryAfterMs(res));
  }
  return res;
}

export function jsonHeaders(extra: Record<string, string | undefined | null>, cfgHeaders?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
  return { ...out, ...(cfgHeaders ?? {}) };
}
