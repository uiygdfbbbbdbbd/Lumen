import { PassThrough, type Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';

/**
 * Wrap a storage stream for sending. If the source fails after headers went out, the response is
 * aborted cleanly (the client sees a truncated download) instead of the error reaching Fastify's
 * error handler, which can't write a second response.
 */
export function safeBody(body: Readable, reply: FastifyReply, log: FastifyBaseLogger): PassThrough {
  const out = new PassThrough();
  body.on('error', (err) => {
    log.warn({ err }, 'storage stream failed mid-response');
    out.destroy();
    reply.raw.destroy();
  });
  out.on('close', () => body.destroy());
  body.pipe(out);
  return out;
}
