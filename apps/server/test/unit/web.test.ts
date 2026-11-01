import { describe, expect, it, vi } from 'vitest';
import { isAllowed, parseRobots } from '../../src/lib/robots.js';
import { convertUnits } from '../../src/services/tools/utility-tools.js';
import { normalizeUrl, urlsIn } from '../../src/services/tools/web-tools.js';
import { searchProvider, type Fetcher } from '../../src/services/web/search-providers.js';
import { domainBlocked } from '../../src/services/web/web.service.js';

describe('robots.txt', () => {
  const txt = `# comment
User-agent: Googlebot
Disallow: /

User-agent: LumenBot
User-agent: OtherBot
Disallow: /private/
Allow: /private/ok$
Disallow: /*.pdf$

User-agent: *
Disallow: /admin`;
  it('uses the most specific group and longest match', () => {
    const r = parseRobots(txt, 'LumenBot');
    expect(isAllowed(r, '/')).toBe(true);
    expect(isAllowed(r, '/private/x')).toBe(false);
    expect(isAllowed(r, '/private/ok')).toBe(true);
    expect(isAllowed(r, '/private/ok/more')).toBe(false);
    expect(isAllowed(r, '/docs/file.pdf')).toBe(false);
    expect(isAllowed(r, '/admin')).toBe(true);
  });
  it('falls back to the * group and allows everything when empty', () => {
    const r = parseRobots(txt, 'SomeoneElse');
    expect(isAllowed(r, '/admin/page')).toBe(false);
    expect(isAllowed(r, '/private/x')).toBe(true);
    expect(isAllowed(parseRobots('', 'LumenBot'), '/anything')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:', 'LumenBot'), '/x')).toBe(true);
  });
});

describe('convertUnits', () => {
  it.each([
    [5, 'miles', 'km', 8.04672],
    [100, 'C', 'F', 212],
    [32, '°F', 'celsius', 0],
    [0, 'C', 'K', 273.15],
    [1, 'kg', 'lb', 2.2046226218],
    [1, 'GiB', 'MB', 1073.741824],
    [3, 'cups', 'ml', 720],
    [60, 'mph', 'km/h', 96.56064],
    [1, 'acre', 'm²', 4046.86],
  ])('%s %s → %s', (v, from, to, expected) => {
    expect(convertUnits(v, from, to).value).toBeCloseTo(expected, 4);
  });
  it('rejects unknown units and mismatched dimensions', () => {
    expect(() => convertUnits(1, 'parsec', 'm')).toThrow(/Unknown unit/);
    expect(() => convertUnits(1, 'kg', 'm')).toThrow(/Can't convert mass/);
  });
});

describe('search provider adapters', () => {
  const respond = (body: unknown, status = 200) => vi.fn<Fetcher>(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const cfg = { baseUrl: 'http://searx:8080', apiKey: 'key-123456', count: 3, safeSearch: true };

  it('SearXNG', async () => {
    const f = respond({ results: [{ title: 'A <b>b</b>', url: 'https://www.a.com/x', content: 'snip' }, { title: 'bad', url: 'javascript:alert(1)' }] });
    const hits = await searchProvider({ ...cfg, provider: 'searxng' }, 'q x', f);
    expect(f.mock.calls[0]![0]).toBe('http://searx:8080/search?q=q+x&format=json&safesearch=1');
    expect(hits).toEqual([{ title: 'A b', url: 'https://www.a.com/x', snippet: 'snip', publishedAt: undefined, siteName: 'a.com' }]);
  });
  it('Brave', async () => {
    const f = respond({ web: { results: [{ title: 'T', url: 'https://b.com', description: 'D' }] } });
    expect((await searchProvider({ ...cfg, provider: 'brave' }, 'q', f))[0]).toMatchObject({ title: 'T', snippet: 'D' });
    expect(f.mock.calls[0]![0]).toContain('api.search.brave.com');
    expect((f.mock.calls[0]![1].headers as Record<string, string>)['x-subscription-token']).toBe('key-123456');
  });
  it('Tavily, Serper, Bing', async () => {
    const t = respond({ results: [{ title: 'T', url: 'https://t.com', content: 'C' }] });
    expect((await searchProvider({ ...cfg, provider: 'tavily' }, 'q', t))[0]!.url).toBe('https://t.com');
    expect(JSON.parse(String(t.mock.calls[0]![1].body))).toEqual({ query: 'q', max_results: 3, search_depth: 'basic' });
    const s = respond({ organic: [{ title: 'S', link: 'https://s.com', snippet: 'x' }] });
    expect((await searchProvider({ ...cfg, provider: 'serper' }, 'q', s))[0]!.title).toBe('S');
    const b = respond({ webPages: { value: [{ name: 'B', url: 'https://bing.example', snippet: 'y' }] } });
    expect((await searchProvider({ ...cfg, provider: 'bing' }, 'q', b))[0]!.title).toBe('B');
  });
  it('maps auth and rate-limit failures, and requires keys', async () => {
    await expect(searchProvider({ ...cfg, provider: 'brave' }, 'q', respond({}, 401))).rejects.toThrow(/key was rejected/);
    await expect(searchProvider({ ...cfg, provider: 'brave' }, 'q', respond({}, 429))).rejects.toThrow(/rate limiting/);
    await expect(searchProvider({ ...cfg, provider: 'tavily', apiKey: null }, 'q', respond({}))).rejects.toThrow(/needs an API key/);
    await expect(searchProvider({ ...cfg, provider: 'searxng', baseUrl: '' }, 'q', respond({}))).rejects.toThrow(/isn’t configured/);
  });
});

describe('url helpers', () => {
  it('finds URLs the user wrote and normalizes them', () => {
    expect(urlsIn('see https://a.com/x?y=1. and (http://b.org/p) or `https://c.io`')).toEqual(['https://a.com/x?y=1', 'http://b.org/p', 'https://c.io']);
    expect(normalizeUrl('https://a.com/x/#frag')).toBe('https://a.com/x');
  });
  it('blocks domains and their subdomains', () => {
    expect(domainBlocked('https://spam.example.com/x', ['example.com'])).toBe(true);
    expect(domainBlocked('https://notexample.com', ['example.com'])).toBe(false);
    expect(domainBlocked('not a url', [])).toBe(true);
  });
});
