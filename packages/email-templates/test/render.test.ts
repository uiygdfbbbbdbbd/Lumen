import { describe, expect, it } from 'vitest';
import { renderEmail, TEMPLATE_NAMES, type TemplateProps } from '../src/index.js';

const brand = { productName: 'Lumen', accentColor: '#6d5dfc', publicUrl: 'http://x', supportEmail: 's@x' };
const samples: TemplateProps = {
  verify_email: { name: 'Ada', url: 'http://x/verify?t=abc', expiresHours: 48 },
  reset_password: { name: 'Ada', url: 'http://x/reset?t=abc', expiresMinutes: 60 },
  magic_link: { name: 'Ada', url: 'http://x/m?t=abc', expiresMinutes: 15 },
  change_email: { name: 'Ada', url: 'http://x/c?t=abc', newEmail: 'n@x', expiresHours: 24 },
  email_changed_notice: { name: 'Ada', newEmail: 'n@x' },
  welcome: { name: 'Ada', appUrl: 'http://x' },
  invite: { inviterName: 'Bob', targetName: 'Proj', url: 'http://x/i' },
  security_alert: { name: 'Ada', event: 'New sign-in', ip: '1.2.3.4', userAgent: 'Firefox', when: 'now', settingsUrl: 'http://x/s' },
  digest: { name: 'Ada', items: [{ title: 'Run done', body: 'ok', url: 'http://x/r' }, { title: 'B', body: 'c' }], settingsUrl: 'http://x/s' },
  test_email: { sentBy: 'admin' },
};

describe('email templates', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`renders ${name} as html + text`, async () => {
      const out = await renderEmail(name, samples[name] as never, brand);
      expect(out.subject).toContain('Lumen');
      expect(out.html).toContain('<html');
      expect(out.text.length).toBeGreaterThan(10);
    });
  }
  it('escapes user-controlled values', async () => {
    const out = await renderEmail('verify_email', { name: '<img src=x onerror=alert(1)>', url: 'http://x', expiresHours: 1 }, brand);
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img');
  });
  it('strips newlines from subjects (header injection)', async () => {
    const out = await renderEmail('invite', { inviterName: 'a\r\nBcc: evil@x', targetName: 't', url: 'u' }, brand);
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
  it('includes the link in plaintext fallback', async () => {
    const out = await renderEmail('reset_password', samples.reset_password, brand);
    expect(out.text).toContain('http://x/reset?t=abc');
    expect(out.html).toContain('http://x/reset?t=abc');
  });
});
