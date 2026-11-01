import { LumenError } from '@lumen/shared';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  siteName?: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface ProviderConfig {
  provider: 'searxng' | 'brave' | 'tavily' | 'serper' | 'bing';
  baseUrl: string;
  apiKey: string | null;
  count: number;
  safeSearch: boolean;
}

const UA = 'LumenBot/1.0 (+web search)';

async function json(res: Response, provider: string): Promise<unknown> {
  if (res.status === 401 || res.status === 403) throw new LumenError('PROVIDER_ERROR', `The ${provider} search key was rejected. Ask an administrator to check it.`);
  if (res.status === 429) throw new LumenError('RATE_LIMITED', `The ${provider} search provider is rate limiting requests.`);
  if (!res.ok) throw new LumenError('PROVIDER_UNAVAILABLE', `${provider} search failed (${res.status}).`);
  return res.json();
}

const clean = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

/** One request per provider, normalized to title/url/snippet. */
export async function searchProvider(cfg: ProviderConfig, query: string, fetcher: Fetcher): Promise<SearchHit[]> {
  const need = (k: string | null) => {
    if (!k) throw new LumenError('PROVIDER_UNAVAILABLE', 'Web search needs an API key. Ask an administrator to add one.');
    return k;
  };
  let hits: SearchHit[] = [];
  switch (cfg.provider) {
    case 'searxng': {
      if (!cfg.baseUrl) throw new LumenError('PROVIDER_UNAVAILABLE', 'Web search isn’t configured.');
      const u = new URL('search', cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      u.searchParams.set('safesearch', cfg.safeSearch ? '1' : '0');
      const data = (await json(await fetcher(u.toString(), { headers: { accept: 'application/json', 'user-agent': UA } }), 'SearXNG')) as { results?: { title?: string; url?: string; content?: string; publishedDate?: string }[] };
      hits = (data.results ?? []).map((r) => ({ title: clean(r.title), url: String(r.url ?? ''), snippet: clean(r.content), publishedAt: r.publishedDate ?? undefined }));
      break;
    }
    case 'brave': {
      const u = new URL('https://api.search.brave.com/res/v1/web/search');
      u.searchParams.set('q', query);
      u.searchParams.set('count', String(cfg.count));
      u.searchParams.set('safesearch', cfg.safeSearch ? 'moderate' : 'off');
      const data = (await json(await fetcher(u.toString(), { headers: { accept: 'application/json', 'x-subscription-token': need(cfg.apiKey) } }), 'Brave')) as { web?: { results?: { title?: string; url?: string; description?: string; page_age?: string }[] } };
      hits = (data.web?.results ?? []).map((r) => ({ title: clean(r.title), url: String(r.url ?? ''), snippet: clean(r.description), publishedAt: r.page_age }));
      break;
    }
    case 'tavily': {
      const data = (await json(
        await fetcher('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${need(cfg.apiKey)}` }, body: JSON.stringify({ query, max_results: cfg.count, search_depth: 'basic' }) }),
        'Tavily',
      )) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
      hits = (data.results ?? []).map((r) => ({ title: clean(r.title), url: String(r.url ?? ''), snippet: clean(r.content), publishedAt: r.published_date }));
      break;
    }
    case 'serper': {
      const data = (await json(
        await fetcher('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': need(cfg.apiKey) }, body: JSON.stringify({ q: query, num: cfg.count, safe: cfg.safeSearch ? 'active' : 'off' }) }),
        'Serper',
      )) as { organic?: { title?: string; link?: string; snippet?: string; date?: string }[] };
      hits = (data.organic ?? []).map((r) => ({ title: clean(r.title), url: String(r.link ?? ''), snippet: clean(r.snippet), publishedAt: r.date }));
      break;
    }
    case 'bing': {
      const u = new URL('https://api.bing.microsoft.com/v7.0/search');
      u.searchParams.set('q', query);
      u.searchParams.set('count', String(cfg.count));
      u.searchParams.set('safeSearch', cfg.safeSearch ? 'Moderate' : 'Off');
      const data = (await json(await fetcher(u.toString(), { headers: { 'ocp-apim-subscription-key': need(cfg.apiKey) } }), 'Bing')) as { webPages?: { value?: { name?: string; url?: string; snippet?: string; dateLastCrawled?: string }[] } };
      hits = (data.webPages?.value ?? []).map((r) => ({ title: clean(r.name), url: String(r.url ?? ''), snippet: clean(r.snippet), publishedAt: r.dateLastCrawled }));
      break;
    }
  }
  return hits.filter((h) => /^https?:\/\//.test(h.url)).map((h) => ({ ...h, siteName: host(h.url) }));
}

/** safeFetch (undici) adapted to the global fetch types used by adapters. */
export function safeFetcher(opts: import('../../lib/ssrf.js').SafeFetchOptions): Fetcher {
  return async (url, init) => {
    const { safeFetch } = await import('../../lib/ssrf.js');
    return (await safeFetch(url, init as never, opts)) as unknown as Response;
  };
}
