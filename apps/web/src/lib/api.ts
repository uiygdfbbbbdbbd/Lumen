import { CSRF_COOKIE, CSRF_HEADER, isErrorCode, LumenError, type ApiErrorBody } from '@lumen/shared';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  csrfPromise ??= fetch('/api/auth/csrf', { credentials: 'include' })
    .then((r) => r.json() as Promise<{ csrfToken: string }>)
    .then((d) => d.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Convert any failed response into a LumenError with a stable code, even for non-JSON bodies. */
export async function toLumenError(res: Response): Promise<LumenError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const e = body?.error;
  if (e && isErrorCode(e.code)) return new LumenError(e.code, e.message, { details: e.details, resetAt: e.resetAt });
  if (res.status === 429) return new LumenError('RATE_LIMITED', 'Too many requests.');
  if (res.status === 401) return new LumenError('UNAUTHENTICATED', 'Please sign in.');
  if (res.status >= 500) return new LumenError('INTERNAL', 'The server had a problem. Try again.');
  return new LumenError('BAD_REQUEST', `Request failed (${res.status}).`);
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'include', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new LumenError('PROVIDER_UNAVAILABLE', 'You appear to be offline. Check your connection.');
  }
  if (!res.ok) throw await toLumenError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.blob()) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof LumenError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Field-level messages from VALIDATION_FAILED details, keyed by path. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof LumenError) || err.code !== 'VALIDATION_FAILED' || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details as { path?: string; message?: string }[]) if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
  return out;
}
