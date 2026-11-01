import type { FastifyReply, FastifyRequest } from 'fastify';
import { CSRF_COOKIE, CSRF_HEADER, LumenError } from '@lumen/shared';
import { timingSafeEqual } from 'node:crypto';
import { randomToken } from '../lib/tokens.js';

/**
 * Double-submit CSRF protection. The CSRF cookie is readable by our own JS only (SameSite=Lax),
 * and every cookie-authenticated mutation must echo it in a header. Cross-site attackers can't read it.
 */
export function enforceCsrf(req: FastifyRequest): void {
  const cookie = req.cookies[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  if (!cookie || typeof header !== 'string' || cookie.length !== header.length) {
    throw new LumenError('CSRF_FAILED', 'Missing or invalid CSRF token. Refresh the page and try again.');
  }
  if (!timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    throw new LumenError('CSRF_FAILED', 'Missing or invalid CSRF token. Refresh the page and try again.');
  }
}

export function ensureCsrfCookie(req: FastifyRequest, reply: FastifyReply, opts: { secure: boolean; domain?: string }): string {
  const existing = req.cookies[CSRF_COOKIE];
  if (existing && /^[A-Za-z0-9_-]{32,64}$/.test(existing)) return existing;
  const token = randomToken(32);
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: opts.secure,
    domain: opts.domain,
    maxAge: 60 * 60 * 24 * 365,
  });
  // Make the fresh token visible to this same request's handler.
  req.cookies[CSRF_COOKIE] = token;
  return token;
}
