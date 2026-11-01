import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedIp, safeFetch, validateUrlShape } from '../../src/lib/ssrf.js';

const lookupTo = (...addrs: string[]) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', '198.18.0.1', '192.0.0.192', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false));

  it('allowPrivate opens private/loopback but never metadata', () => {
    expect(isBlockedIp('127.0.0.1', { allowPrivate: true })).toBe(false);
    expect(isBlockedIp('192.168.1.10', { allowPrivate: true })).toBe(false);
    expect(isBlockedIp('169.254.169.254', { allowPrivate: true })).toBe(true);
    expect(isBlockedIp('fd00:ec2::254', { allowPrivate: true })).toBe(true);
  });
});

describe('validateUrlShape', () => {
  it.each(['file:///etc/passwd', 'gopher://x', 'ftp://x.com', 'javascript:alert(1)', 'http://user:pw@example.com', 'not a url', 'http://localhost:11434', 'http://foo.internal', 'http://metadata.google.internal', 'http://[::1]/', 'http://2130706433/', 'http://0x7f000001/'])(
    'rejects %s',
    (u) => expect(() => validateUrlShape(u)).toThrow(/Blocked/),
  );
  it('enforces port allowlist', () => {
    expect(() => validateUrlShape('https://example.com:8443', { allowedPorts: [443] })).toThrow(/port/);
    expect(validateUrlShape('https://example.com', { allowedPorts: [443] }).hostname).toBe('example.com');
  });
  it('allows localhost only with allowPrivate', () => {
    expect(validateUrlShape('http://localhost:11434', { allowPrivate: true }).port).toBe('11434');
  });
});

describe('assertSafeUrl (DNS)', () => {
  it('blocks hostnames resolving to private addresses', async () => {
    await expect(assertSafeUrl('https://evil.example', {}, lookupTo('10.0.0.1'))).rejects.toThrow(/private/);
  });
  it('blocks if ANY record is private (mixed-record trick)', async () => {
    await expect(assertSafeUrl('https://evil.example', {}, lookupTo('8.8.8.8', '127.0.0.1'))).rejects.toThrow();
  });
  it('blocks IPv6 private records', async () => {
    await expect(assertSafeUrl('https://evil.example', {}, lookupTo('::ffff:169.254.169.254'))).rejects.toThrow();
  });
  it('blocks unresolvable and empty results', async () => {
    await expect(assertSafeUrl('https://x.example', {}, async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/resolve/);
    await expect(assertSafeUrl('https://x.example', {}, lookupTo())).rejects.toThrow(/no addresses/);
  });
  it('allows public hosts', async () => {
    const u = await assertSafeUrl('https://api.example.com/v1', {}, lookupTo('93.184.216.34'));
    expect(u.pathname).toBe('/v1');
  });
});

describe('safeFetch against a real local server', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect-internal') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      }
      if (req.url === '/redirect-ok') {
        res.writeHead(301, { location: '/ok' });
        return res.end();
      }
      if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        return res.end();
      }
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('blocks loopback by default', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/Blocked/);
  });
  it('DNS rebinding: hostname validated public, connect-time lookup returns loopback -> blocked', async () => {
    let calls = 0;
    const rebinding = async () => {
      calls += 1;
      return [{ address: calls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
    };
    await expect(safeFetch(`http://rebind.example:${port}/`, {}, { lookup: rebinding })).rejects.toThrow();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
  it('follows safe redirects when private targets are allowed', async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/redirect-ok`, {}, { allowPrivate: true });
    expect(await res.text()).toBe('ok');
  });
  it('re-validates every redirect hop (metadata blocked even with allowPrivate)', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-internal`, {}, { allowPrivate: true })).rejects.toThrow(/Blocked/);
  });
  it('caps redirects', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/loop`, {}, { allowPrivate: true, maxRedirects: 3 })).rejects.toThrow(/too many redirects/);
  });
});
