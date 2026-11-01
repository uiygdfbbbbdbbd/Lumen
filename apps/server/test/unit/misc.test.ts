import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { REDACT_PATHS, scrubSecrets, createLogger } from '../../src/lib/logger.js';
import { sanitizeMetadata } from '../../src/services/audit/audit.service.js';
import { domainAllowed, isDisposable } from '../../src/services/auth/disposable-domains.js';
import { coarseLocation, describeUserAgent } from '../../src/services/auth/geo.js';
import { noCaptcha, remoteCaptcha } from '../../src/services/auth/captcha.js';
import { MailgunTransport, MemoryTransport, ResendTransport, SendGridTransport, LogTransport } from '../../src/services/email/transports.js';
import { assertSafeKey, FsStorage } from '../../src/services/storage/storage.js';

describe('log scrubbing', () => {
  it('masks API keys, bearer tokens and key=value secrets', () => {
    const s = scrubSecrets('upstream said: Authorization: Bearer abc.def.ghi123 key sk-proj-ABCDEFGHIJKLMNOP and api_key=hunter2 AIzaSyA1234567890abcdefghijk');
    expect(s).not.toContain('abc.def.ghi123');
    expect(s).not.toContain('ABCDEFGHIJKLMNOP');
    expect(s).not.toContain('hunter2');
    expect(s).not.toContain('AIzaSyA1234567890');
  });
  it('pino redacts configured paths', () => {
    const lines: string[] = [];
    const logger = createLogger('info');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    logger.info({ password: 'p@ss', nested: { apiKey: 'sk-1', token: 't' }, req: { headers: { authorization: 'Bearer z', cookie: 'c' } } }, 'x');
    logger.flush?.();
    write.mockRestore();
    const out = lines.join('');
    for (const secret of ['p@ss', 'sk-1', '"t"', 'Bearer z']) expect(out).not.toContain(secret);
    expect(REDACT_PATHS.length).toBeGreaterThan(5);
  });
});

describe('audit metadata sanitizer', () => {
  it('redacts nested secret keys', () => {
    expect(sanitizeMetadata({ a: 1, apiKey: 'x', nested: { password: 'y', ok: true }, list: [1] })).toEqual({
      a: 1,
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]', ok: true },
      list: [1],
    });
  });
});

describe('email domain rules', () => {
  it('detects disposable domains and subdomains', () => {
    expect(isDisposable('x@mailinator.com')).toBe(true);
    expect(isDisposable('x@foo.mailinator.com')).toBe(true);
    expect(isDisposable('x@gmail.com')).toBe(false);
  });
  it('allowlist matches domain and subdomains only', () => {
    expect(domainAllowed('a@corp.com', ['corp.com'])).toBe(true);
    expect(domainAllowed('a@eu.corp.com', ['@corp.com'])).toBe(true);
    expect(domainAllowed('a@evilcorp.com', ['corp.com'])).toBe(false);
  });
});

describe('geo + UA', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;
  it('reads country only behind a trusted proxy', () => {
    expect(coarseLocation(req({ 'cf-ipcountry': 'NL' }), true)).toBe('NL');
    expect(coarseLocation(req({ 'cf-ipcountry': 'NL' }), false)).toBeNull();
    expect(coarseLocation(req({ 'cf-ipcountry': 'XX' }), true)).toBeNull();
    expect(coarseLocation(req({ 'cf-ipcountry': '<script>' }), true)).toBeNull();
  });
  it('describes user agents', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537')).toBe('Chrome on Windows');
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0')).toBe('Firefox on Linux');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Mac OS X 14) Safari/605')).toBe('Safari on macOS');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });
});

describe('captcha', () => {
  it('noCaptcha always passes', async () => expect(await noCaptcha.verify(undefined, 'ip')).toBe(true));
  it('remote verifier posts token and reads success', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    const v = remoteCaptcha('turnstile', 'secret', f as unknown as typeof fetch);
    expect(await v.verify('tok', '1.2.3.4')).toBe(true);
    expect(await v.verify(undefined, '1.2.3.4')).toBe(false);
    const bad = remoteCaptcha('hcaptcha', 's', (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch);
    expect(await bad.verify('t', 'ip')).toBe(false);
    const thrown = remoteCaptcha('hcaptcha', 's', (async () => { throw new Error('x'); }) as unknown as typeof fetch);
    expect(await thrown.verify('t', 'ip')).toBe(false);
  });
});

describe('email transports', () => {
  const msg = { from: 'Lumen <a@x>', to: 'b@x', subject: 's', html: '<p>h</p>', text: 'see https://x/verify?token=1' };
  it('memory transport captures', async () => {
    const t = new MemoryTransport();
    await t.send(msg);
    expect(t.lastTo('b@x')?.subject).toBe('s');
    t.clear();
    expect(t.outbox).toHaveLength(0);
  });
  it('resend/sendgrid/mailgun call their APIs with auth', async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'm1' }), { headers: { 'x-message-id': 'sg1' } }));
    const ff = f as unknown as typeof fetch;
    expect((await new ResendTransport('re_key', ff).send(msg)).messageId).toBe('m1');
    expect(f.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
    expect((f.mock.calls[0]![1].headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect((await new SendGridTransport('sg_key', ff).send(msg)).messageId).toBe('sg1');
    expect(JSON.parse(f.mock.calls[1]![1].body as string).from.email).toBe('a@x');
    expect((await new MailgunTransport('mg', 'mg.x', 'eu', ff).send(msg)).messageId).toBe('m1');
    expect(f.mock.calls[2]![0]).toBe('https://api.eu.mailgun.net/v3/mg.x/messages');
  });
  it('provider errors throw', async () => {
    const f = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect(new ResendTransport('k', f).send(msg)).rejects.toThrow(/401/);
    await expect(new MailgunTransport('k', 'd', 'us', f).send(msg)).rejects.toThrow(/401/);
  });
  it('log transport extracts links', async () => {
    const info = vi.fn();
    await new LogTransport({ info } as never).send(msg);
    expect(info.mock.calls[0]![0].links).toEqual(['https://x/verify?token=1']);
  });
});

describe('FsStorage', () => {
  let root = '';
  afterAll(() => rm(root, { recursive: true, force: true }));
  it('puts, gets, checks and deletes', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'lumen-st-'));
    const s = new FsStorage(root);
    await s.put('a/b.txt', Buffer.from('hello'), 'text/plain');
    expect(await s.exists('a/b.txt')).toBe(true);
    const obj = await s.get('a/b.txt');
    expect(obj?.contentType).toBe('text/plain');
    expect(Buffer.concat(await obj!.body.toArray()).toString()).toBe('hello');
    await s.put('a/c.bin', Readable.from([Buffer.from('xy')]), 'application/octet-stream');
    expect((await s.get('a/c.bin'))?.size).toBe(2);
    await s.delete('a/b.txt');
    expect(await s.get('a/b.txt')).toBeNull();
    expect(await s.exists('a/b.txt')).toBe(false);
  });
  it.each(['../etc/passwd', '/abs', 'a/../../x', 'a//b', '', '.hidden'])('rejects unsafe key %j', (k) => {
    expect(() => assertSafeKey(k)).toThrow();
  });
});
