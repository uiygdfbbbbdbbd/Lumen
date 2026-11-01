import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuiltinTheme } from '@lumen/shared';
import { api, errorMessage, fieldErrors, toLumenError } from '../src/lib/api.js';
import { formatBytes, greetingKey, registerCatalog, relativeTime, setLocale, t } from '../src/lib/i18n.js';
import { applyTheme, resolveTheme, useThemeStore } from '../src/lib/theme.js';
import { startersFor } from '../src/features/shell/starters.js';
import { LumenError } from '@lumen/shared';

describe('api client', () => {
  beforeEach(() => {
    document.cookie = 'lumen_csrf=abc123abc123abc123abc123abc123abc123abc; path=/';
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends JSON with the CSRF header on mutations and parses responses', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { headers: { 'content-type': 'application/json' } }));
    expect(await api('/api/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: 1 });
    const init = f.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('abc123abc123abc123abc123abc123abc123abc');
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe('include');
  });
  it('maps error bodies to LumenError with stable codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'Daily limit', resetAt: '2026-01-01T00:00:00Z' } }), { status: 429 }),
    );
    const err = await api('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LumenError);
    expect((err as LumenError).code).toBe('QUOTA_EXCEEDED');
    expect((err as LumenError).resetAt).toBe('2026-01-01T00:00:00Z');
  });
  it('handles non-JSON errors, 204 and offline', async () => {
    expect((await toLumenError(new Response('nope', { status: 500 }))).code).toBe('INTERNAL');
    expect((await toLumenError(new Response('', { status: 401 }))).code).toBe('UNAUTHENTICATED');
    expect((await toLumenError(new Response('', { status: 429 }))).code).toBe('RATE_LIMITED');
    expect((await toLumenError(new Response('', { status: 418 }))).code).toBe('BAD_REQUEST');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api('/api/x', { method: 'DELETE' })).toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(((await api('/api/x').catch((e: unknown) => e)) as LumenError).message).toMatch(/offline/);
  });
  it('extracts field errors and messages', () => {
    const e = new LumenError('VALIDATION_FAILED', 'bad', { details: [{ path: 'email', message: 'Invalid' }, { path: 'email', message: 'second' }] });
    expect(fieldErrors(e)).toEqual({ email: 'Invalid' });
    expect(fieldErrors(new Error('x'))).toEqual({});
    expect(errorMessage(e)).toBe('bad');
    expect(errorMessage('x')).toBe('Something went wrong.');
  });
});

describe('i18n', () => {
  it('interpolates and falls back', () => {
    expect(t('greeting.morning', { name: 'Ada' })).toBe('Good morning, Ada');
    expect(t('missing.key')).toBe('missing.key');
    registerCatalog('nl', { 'greeting.morning': 'Goedemorgen, {name}' });
    setLocale('nl-NL');
    expect(t('greeting.morning', { name: 'Ada' })).toBe('Goedemorgen, Ada');
    expect(t('auth.signIn')).toBe('Sign in');
    setLocale('xx');
    expect(document.documentElement.lang).toBe('en');
  });
  it('greets by time of day', () => {
    expect([3, 8, 14, 20, 23].map(greetingKey)).toEqual(['greeting.night', 'greeting.morning', 'greeting.afternoon', 'greeting.evening', 'greeting.night']);
  });
  it('formats bytes and relative time', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(15 * 1024 ** 3)).toBe('15 GB');
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime('2026-01-01T11:59:30Z', now)).toMatch(/seconds? ago|now/);
    expect(relativeTime('2026-01-01T11:00:00Z', now)).toMatch(/hour/);
    expect(relativeTime('2025-12-30T12:00:00Z', now)).toMatch(/days? ago/);
  });
});

describe('theme engine', () => {
  const prefs = { mode: 'system' as const, lightThemeId: 'paper', darkThemeId: 'nord', custom: {}, dayStartHour: 7, nightStartHour: 19 };
  it('resolves by mode, system preference and time of day', () => {
    expect(resolveTheme(prefs, { systemDark: true, hour: 12 }).id).toBe('nord');
    expect(resolveTheme(prefs, { systemDark: false, hour: 12 }).id).toBe('paper');
    expect(resolveTheme({ ...prefs, mode: 'dark' }, { systemDark: false, hour: 12 }).id).toBe('nord');
    expect(resolveTheme({ ...prefs, mode: 'time' }, { systemDark: false, hour: 22 }).id).toBe('nord');
    expect(resolveTheme({ ...prefs, mode: 'time' }, { systemDark: true, hour: 9 }).id).toBe('paper');
    expect(resolveTheme({ ...prefs, mode: 'light', lightThemeId: 'gone' }, { systemDark: false, hour: 1 }).theme.name).toBe('Light');
  });
  it('applies CSS variables and caches them for the boot script', () => {
    applyTheme(getBuiltinTheme('nord')!);
    expect(document.documentElement.style.getPropertyValue('--lm-bg')).toBe('#2e3440');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('lumen.theme.vars')!)['--lm-bg']).toBe('#2e3440');
  });
  it('saves and deletes custom themes, resetting selection', () => {
    const custom = { ...getBuiltinTheme('dark')!, name: 'Mine' };
    useThemeStore.getState().saveCustom('c1', custom);
    useThemeStore.getState().set({ darkThemeId: 'c1' });
    expect(resolveTheme({ ...useThemeStore.getState(), mode: 'dark' }, { systemDark: true, hour: 0 }).theme.name).toBe('Mine');
    useThemeStore.getState().deleteCustom('c1');
    expect(useThemeStore.getState().darkThemeId).toBe('dark');
    expect(JSON.parse(localStorage.getItem('lumen.theme.prefs')!).custom).toEqual({});
  });
});

describe('starters', () => {
  it('round-robins across chosen use cases', () => {
    const s = startersFor(['coding', 'creative'], 4);
    expect(s.map((x) => x.useCase)).toEqual(['coding', 'creative', 'coding', 'creative']);
    expect(startersFor([], 4)).toHaveLength(4);
  });
});
