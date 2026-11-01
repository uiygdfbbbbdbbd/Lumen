/**
 * SSRF-safe outbound HTTP.
 * - Only http/https, no userinfo in URLs, optional port allowlist.
 * - Every resolved IP is checked against private/reserved ranges (IPv4, IPv6, IPv4-mapped IPv6).
 * - The check runs inside the socket `lookup`, so the IP we validate is the IP we connect to (defeats DNS rebinding).
 * - Redirects are followed manually and each hop is re-validated.
 */
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch, type Dispatcher, type RequestInit, type Response } from 'undici';
import { LumenError } from '@lumen/shared';

const BLOCKED_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'carrierGradeNat',
  'private',
  'reserved',
  'uniqueLocal',
  'ipv4Mapped',
  'rfc6145',
  'rfc6052',
  '6to4',
  'teredo',
  'benchmarking',
  'amt',
  'as112',
  'as112v6',
  'deprecated',
  'orchid2',
  'droneRemoteIdProtocolEntityTags',
]);

/** Explicit extras not always covered by range names (cloud metadata endpoints). */
const BLOCKED_EXACT = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200', '192.0.0.192']);

export interface SsrfOptions {
  /** Allow private/loopback targets (e.g. admin-approved local Ollama). Metadata IPs stay blocked. */
  allowPrivate?: boolean;
  allowedPorts?: number[];
}

export function isBlockedIp(ip: string, opts: SsrfOptions = {}): boolean {
  if (!ipaddr.isValid(ip)) return true;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  const normalized = addr.toString();
  if (BLOCKED_EXACT.has(normalized)) return true;
  // NAT64 / 6to4 / Teredo can smuggle IPv4 targets; block them outright.
  const range: string = addr.range();
  if (range === 'unicast') return false;
  if (opts.allowPrivate && ['private', 'loopback', 'uniqueLocal', 'carrierGradeNat'].includes(range)) return false;
  // Anything that isn't plain global unicast is blocked, including ranges ipaddr.js may add later.
  return BLOCKED_RANGES.has(range) || true;
}

function block(reason: string): never {
  throw new LumenError('SSRF_BLOCKED', `Blocked outbound request: ${reason}`);
}

export function validateUrlShape(raw: string, opts: SsrfOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    block('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') block(`scheme ${url.protocol} not allowed`);
  if (url.username || url.password) block('credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) block('missing host');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host) && !opts.allowPrivate) {
    block('internal hostname');
  }
  if (opts.allowedPorts && url.port && !opts.allowedPorts.includes(Number(url.port))) block(`port ${url.port} not allowed`);
  if (net.isIP(host) && isBlockedIp(host, opts)) block(`address ${host} is private or reserved`);
  return url;
}

type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;
const defaultLookup: LookupFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** Resolve and validate every address. Throws if any record is blocked (prevents mixed-record tricks). */
export async function assertSafeUrl(raw: string, opts: SsrfOptions = {}, lookup: LookupFn = defaultLookup): Promise<URL> {
  const url = validateUrlShape(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return url;
  let records: { address: string }[];
  try {
    records = await lookup(host);
  } catch {
    block(`could not resolve ${host}`);
  }
  if (records.length === 0) block(`no addresses for ${host}`);
  for (const r of records) if (isBlockedIp(r.address, opts)) block(`${host} resolves to a private or reserved address`);
  return url;
}

/** undici Agent whose DNS lookup rejects blocked addresses at connect time. */
export function createSafeAgent(opts: SsrfOptions = {}, lookup: LookupFn = defaultLookup): Agent {
  return new Agent({
    connect: {
      lookup: (hostname, _options, cb) => {
        lookup(hostname)
          .then((records) => {
            const bad = records.find((r) => isBlockedIp(r.address, opts));
            if (records.length === 0 || bad) {
              cb(new LumenError('SSRF_BLOCKED', `Blocked outbound request: ${hostname} resolves to a disallowed address`), '', 4);
              return;
            }
            const first = records[0]!;
            cb(null, first.address, first.family);
          })
          .catch((err: Error) => cb(err, '', 4));
      },
    },
    headersTimeout: 30_000,
    bodyTimeout: 300_000,
  });
}

export interface SafeFetchOptions extends SsrfOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  dispatcher?: Dispatcher;
  lookup?: LookupFn;
}

export async function safeFetch(raw: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const dispatcher = opts.dispatcher ?? createSafeAgent(opts, opts.lookup);
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeUrl(current, opts, opts.lookup);
    const res = await undiciFetch(current, {
      ...init,
      redirect: 'manual',
      dispatcher,
      signal: init.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString();
      await res.body?.cancel();
      if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && res.status !== 307 && res.status !== 308) {
        init = { ...init, method: 'GET', body: undefined };
      }
      continue;
    }
    return res;
  }
  block('too many redirects');
}
