import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailTransport {
  readonly name: string;
  send(msg: OutgoingEmail): Promise<{ messageId: string | null }>;
}

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  private readonly t: Transporter;
  constructor(opts: { host: string; port: number; secure: boolean; user?: string; password?: string }) {
    this.t = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.password ?? '' } : undefined,
    });
  }
  async send(msg: OutgoingEmail) {
    const info = await this.t.sendMail(msg);
    return { messageId: info.messageId ?? null };
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  return res;
}

export class ResendTransport implements EmailTransport {
  readonly name = 'resend';
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(msg: OutgoingEmail) {
    const res = await postJson(
      'https://api.resend.com/emails',
      { authorization: `Bearer ${this.apiKey}` },
      { from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers },
      this.fetchImpl,
    );
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? null };
  }
}

export class SendGridTransport implements EmailTransport {
  readonly name = 'sendgrid';
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(msg: OutgoingEmail) {
    const res = await postJson(
      'https://api.sendgrid.com/v3/mail/send',
      { authorization: `Bearer ${this.apiKey}` },
      {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: msg.from.replace(/^.*<|>$/g, '') },
        subject: msg.subject,
        content: [
          { type: 'text/plain', value: msg.text },
          { type: 'text/html', value: msg.html },
        ],
      },
      this.fetchImpl,
    );
    return { messageId: res.headers.get('x-message-id') };
  }
}

export class MailgunTransport implements EmailTransport {
  readonly name = 'mailgun';
  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
    private readonly region: 'us' | 'eu' = 'us',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: OutgoingEmail) {
    const host = this.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
    const form = new URLSearchParams({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    const res = await this.fetchImpl(`https://${host}/v3/${encodeURIComponent(this.domain)}/messages`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id ?? null };
  }
}

/** Captures messages in memory. Used by tests (the Mailpit equivalent when Docker isn't available). */
export class MemoryTransport implements EmailTransport {
  readonly name = 'memory';
  readonly outbox: OutgoingEmail[] = [];
  async send(msg: OutgoingEmail) {
    this.outbox.push(msg);
    return { messageId: `mem-${this.outbox.length}` };
  }
  lastTo(to: string): OutgoingEmail | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
  clear() {
    this.outbox.length = 0;
  }
}

/** Dev fallback: logs subject + links so developers can click through without SMTP. */
export class LogTransport implements EmailTransport {
  readonly name = 'log';
  constructor(private readonly log: Logger) {}
  async send(msg: OutgoingEmail) {
    const links = [...msg.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
    this.log.info({ to: msg.to, subject: msg.subject, links }, 'email (log transport)');
    return { messageId: null };
  }
}
