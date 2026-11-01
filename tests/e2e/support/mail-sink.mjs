// Tiny SMTP capture with a Mailpit-compatible HTTP subset, for environments without Docker.
// SMTP on MAIL_SINK_SMTP_PORT (default 1025), HTTP on MAIL_SINK_HTTP_PORT (default 8025):
//   GET    /api/v1/messages            -> { messages: [{ ID, To: [{Address}], Subject, Created }] }
//   GET    /api/v1/message/:id         -> { ID, Subject, Text, HTML, To }
//   DELETE /api/v1/messages            -> clears the mailbox
import http from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const messages = [];
let seq = 0;

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, cb) {
    simpleParser(stream)
      .then((m) => {
        messages.push({
          ID: String(++seq),
          Subject: m.subject ?? '',
          Text: m.text ?? '',
          HTML: typeof m.html === 'string' ? m.html : '',
          To: (m.to?.value ?? []).map((a) => ({ Address: a.address })),
          Created: new Date().toISOString(),
        });
        cb();
      })
      .catch(cb);
  },
});
smtp.listen(Number(process.env.MAIL_SINK_SMTP_PORT ?? 1025), '127.0.0.1');

http
  .createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/api/v1/messages') return send(200, { messages: [...messages].reverse().map(({ Text, HTML, ...m }) => m) });
    const m = /^\/api\/v1\/message\/(\d+)$/.exec(req.url ?? '');
    if (req.method === 'GET' && m) {
      const msg = messages.find((x) => x.ID === m[1]);
      return msg ? send(200, msg) : send(404, { error: 'not found' });
    }
    if (req.method === 'DELETE' && req.url === '/api/v1/messages') {
      messages.length = 0;
      return send(200, {});
    }
    send(404, { error: 'not found' });
  })
  .listen(Number(process.env.MAIL_SINK_HTTP_PORT ?? 8025), '127.0.0.1');

console.log('mail sink ready');
