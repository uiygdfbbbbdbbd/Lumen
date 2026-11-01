const MAIL_API = process.env.MAIL_API ?? 'http://127.0.0.1:8025';

interface Summary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Poll the Mailpit(-compatible) API for the newest message to `to` matching `subject`. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 10_000): Promise<{ Subject: string; Text: string; HTML: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAIL_API}/api/v1/messages`)).json()) as { messages: Summary[] };
    const hit = list.messages.find((m) => m.To.some((a) => a.Address.toLowerCase() === to.toLowerCase()) && subject.test(m.Subject));
    if (hit) return (await (await fetch(`${MAIL_API}/api/v1/message/${hit.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject} within ${timeoutMs}ms`);
}

export function linkFrom(text: string, path: string): string {
  const m = new RegExp(`https?://[^\\s]+${path.replace(/[/]/g, '\\/')}\\?token=[A-Za-z0-9_%-]+`).exec(text);
  if (!m) throw new Error(`no ${path} link`);
  return m[0];
}
