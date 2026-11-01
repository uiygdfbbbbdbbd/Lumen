import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '@lumen/shared';
import type { Container } from '../container.js';
import { setSessionCookie } from './cookies.js';

/** Resolve the caller once per request: session cookie first, then (if allowed) API key bearer token. */
export async function resolveAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  c: Container,
  opts: { allowApiKey: boolean },
): Promise<void> {
  if (req.authResolved) return;
  req.authResolved = true;
  req.auth = null;

  const authz = req.headers.authorization;
  if (opts.allowApiKey && authz?.startsWith('Bearer ') && c.apiKeyAuth) {
    req.auth = await c.apiKeyAuth.authenticate(authz.slice(7).trim(), req.ip);
    return;
  }

  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const result = await c.sessions.authenticate(token, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
  if (!result) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return;
  }
  if (result.newToken) setSessionCookie(reply, c.config, result.newToken, result.session.expiresAt);
  req.auth = {
    user: result.user,
    sessionId: result.session.id,
    apiKeyId: null,
    scopes: null,
    method: 'session',
    entitlements: await c.entitlements.forUser(result.user),
  };
}
