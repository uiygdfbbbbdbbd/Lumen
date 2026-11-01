import { LumenError } from '@lumen/shared';
import type { Logger } from 'pino';
import type { SecretBox } from '../../lib/crypto.js';
import { isAllowed, parseRobots, type RobotsRules } from '../../lib/robots.js';
import { safeFetch, type SafeFetchOptions } from '../../lib/ssrf.js';
import { extract, htmlToText } from '../files/extract.js';
import type { SettingsService } from '../settings/settings.service.js';
import { safeFetcher, searchProvider, type Fetcher, type SearchHit } from './search-providers.js';

export const WEB_AGENT = 'LumenBot';
const UA = `${WEB_AGENT}/1.0 (+https://github.com/lumen; AI assistant fetching a page a user asked about)`;
const MAX_BYTES = 5 * 1024 * 1024;
export const SEARCH_KEY_AAD = 'settings:webSearch:apiKey';

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  siteName: string;
}

class TtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();
  constructor(private readonly max: number) {}
  get(key: string, ttlMs: number, now: number): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at > ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V, now: number) {
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

export function domainBlocked(url: string, blocked: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return blocked.some((d) => {
    const b = d.toLowerCase().replace(/^\*?\.?/, '');
    return b && (host === b || host.endsWith(`.${b}`));
  });
}

interface Readable {
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

async function readCapped(res: Readable, max: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new LumenError('PAYLOAD_TOO_LARGE', 'That page is too large to read.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Web search through the admin-configured provider, and safe page fetching for the model. */
export class WebService {
  private readonly searchCache = new TtlCache<SearchHit[]>(500);
  private readonly pageCache = new TtlCache<FetchedPage>(300);
  private readonly robotsCache = new TtlCache<RobotsRules | null>(500);

  constructor(
    private readonly settings: SettingsService,
    private readonly box: SecretBox,
    private readonly log: Logger,
    /** SSRF policy for page fetches (tests allow private hosts). */
    private readonly fetchOpts: SafeFetchOptions = {},
    private readonly now: () => number = Date.now,
    /** Only for provider adapters' requests (tests inject a fake). */
    private readonly providerFetcher?: Fetcher,
  ) {}

  async configured(): Promise<boolean> {
    return (await this.settings.get('webSearch')).provider !== 'none';
  }

  async search(query: string, opts: { count?: number; blockedDomains?: string[] } = {}): Promise<SearchHit[]> {
    const cfg = await this.settings.get('webSearch');
    if (cfg.provider === 'none') throw new LumenError('FEATURE_LOCKED', 'Web search isn’t set up on this server.');
    const q = query.trim().slice(0, 400);
    if (!q) throw new LumenError('VALIDATION_FAILED', 'Search query is empty.');
    const count = Math.min(opts.count ?? cfg.maxResults, 20);
    const ttl = cfg.cacheTtlMinutes * 60_000;
    const key = `${cfg.provider}:${count}:${cfg.safeSearch}:${q.toLowerCase()}`;
    let hits = ttl ? this.searchCache.get(key, ttl, this.now()) : undefined;
    if (!hits) {
      const apiKey = cfg.apiKeyEncrypted ? this.box.decrypt(cfg.apiKeyEncrypted, SEARCH_KEY_AAD) : null;
      // The SearXNG URL is admin-configured and usually on the private network; metadata IPs stay blocked.
      const fetcher: Fetcher = this.providerFetcher ?? safeFetcher({ allowPrivate: cfg.provider === 'searxng', timeoutMs: 15_000, maxRedirects: 2 });
      hits = await searchProvider({ provider: cfg.provider, baseUrl: cfg.baseUrl, apiKey, count, safeSearch: cfg.safeSearch }, q, fetcher);
      if (ttl) this.searchCache.set(key, hits, this.now());
    }
    const blocked = [...cfg.blockedDomains, ...(opts.blockedDomains ?? [])];
    const seen = new Set<string>();
    return hits
      .filter((h) => !domainBlocked(h.url, blocked))
      .filter((h) => {
        const k = h.url.replace(/#.*$/, '').replace(/\/$/, '');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, count);
  }

  private async robots(origin: string): Promise<RobotsRules | null> {
    const cached = this.robotsCache.get(origin, 3_600_000, this.now());
    if (cached !== undefined) return cached;
    let rules: RobotsRules | null = null;
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { headers: { 'user-agent': UA } }, { ...this.fetchOpts, timeoutMs: 8_000, maxRedirects: 3 });
      if (res.ok && (res.headers.get('content-type') ?? 'text/plain').includes('text')) rules = parseRobots((await readCapped(res, 512 * 1024)).toString('utf8'), WEB_AGENT);
      else await res.body?.cancel();
    } catch {
      rules = null;
    }
    this.robotsCache.set(origin, rules, this.now());
    return rules;
  }

  async fetchPage(raw: string): Promise<FetchedPage> {
    const cfg = await this.settings.get('webSearch');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new LumenError('VALIDATION_FAILED', 'That isn’t a valid URL.');
    }
    if (!/^https?:$/.test(url.protocol)) throw new LumenError('VALIDATION_FAILED', 'Only http and https pages can be fetched.');
    url.hash = '';
    if (domainBlocked(url.toString(), cfg.blockedDomains)) throw new LumenError('FORBIDDEN', 'This site is blocked by the administrator.');
    const ttl = cfg.cacheTtlMinutes * 60_000;
    const cached = ttl ? this.pageCache.get(url.toString(), ttl, this.now()) : undefined;
    if (cached) return cached;
    if (cfg.respectRobots) {
      const rules = await this.robots(url.origin);
      if (rules && !isAllowed(rules, `${url.pathname}${url.search}`)) throw new LumenError('FORBIDDEN', 'This site asks automated agents not to read that page (robots.txt).');
    }
    let res: Awaited<ReturnType<typeof safeFetch>>;
    try {
      res = await safeFetch(url.toString(), { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.5' } }, { ...this.fetchOpts, timeoutMs: 20_000, maxRedirects: 5 });
    } catch (err) {
      this.log.debug({ err, url: url.toString() }, 'web fetch failed');
      throw new LumenError('PROVIDER_UNAVAILABLE', `Couldn’t reach ${url.hostname}.`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new LumenError('PROVIDER_UNAVAILABLE', `${url.hostname} returned ${res.status}.`);
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    const body = await readCapped(res, MAX_BYTES);
    let title = '';
    let text: string;
    if (type.includes('pdf')) {
      const r = await extract('pdf', 'page.pdf', body, { maxEntries: 0, maxBytes: 0 }, { stripImageMetadata: true });
      text = r.sections.map((s) => s.text).join('\n\n');
    } else if (type.includes('html') || type.includes('xml') || !type) {
      const r = htmlToText(body.toString('utf8'), url.toString());
      title = r.title;
      text = r.text;
    } else if (type.startsWith('text/') || type.includes('json')) {
      text = body.toString('utf8');
    } else {
      throw new LumenError('UNSUPPORTED_MEDIA_TYPE', `Can’t read ${type || 'this kind of file'} pages.`);
    }
    const truncated = text.length > cfg.fetchMaxChars;
    const page: FetchedPage = { url: url.toString(), title: title || url.hostname, text: truncated ? `${text.slice(0, cfg.fetchMaxChars)}…` : text, truncated, siteName: url.hostname.replace(/^www\./, '') };
    if (ttl) this.pageCache.set(url.toString(), page, this.now());
    return page;
  }
}
