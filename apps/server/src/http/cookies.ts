import type { FastifyReply } from 'fastify';
import { SESSION_COOKIE } from '@lumen/shared';
import type { Config } from '../config/index.js';

export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    domain: config.COOKIE_DOMAIN,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', domain: config.COOKIE_DOMAIN });
}
