import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CSRF_COOKIE, loginSchema, permissionsFor, requestEmailSchema, resetPasswordSchema, signupSchema, tokenSchema } from '@lumen/shared';
import type { Container } from '../container.js';
import { clearSessionCookie, setSessionCookie } from '../http/cookies.js';
import { route } from '../http/route.js';
import { coarseLocation } from '../services/auth/geo.js';
import { passwordStrength } from '../lib/password-strength.js';
import type { UserRow } from '../db/schema/index.js';

const MIN = 60_000;

export function sessionMeta(req: FastifyRequest, c: Container) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] ?? null, location: coarseLocation(req, c.config.TRUST_PROXY) };
}

export async function meResponse(c: Container, user: UserRow) {
  return {
    user: c.users.toMe(user),
    entitlements: await c.entitlements.forUser(user),
    permissions: permissionsFor(user.role),
  };
}

export function authRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/auth/csrf',
    auth: 'public',
    allowInMaintenance: true,
    handler: async ({ req }) => ({ csrfToken: req.cookies[CSRF_COOKIE] }),
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/signup',
    auth: 'public',
    body: signupSchema,
    rateLimit: { name: 'auth:signup', limit: 10, windowMs: 15 * MIN },
    handler: async ({ req, reply, body }) => {
      const r = await c.auth.signup(body, sessionMeta(req, c));
      setSessionCookie(reply, c.config, r.token, r.session.expiresAt);
      return reply.code(201).send(await meResponse(c, r.user));
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/login',
    auth: 'public',
    allowInMaintenance: true,
    body: loginSchema,
    rateLimit: { name: 'auth:login', limit: 20, windowMs: 15 * MIN },
    handler: async ({ req, reply, body }) => {
      const r = await c.auth.login(body, sessionMeta(req, c));
      setSessionCookie(reply, c.config, r.token, r.session.expiresAt);
      return meResponse(c, r.user);
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/logout',
    auth: 'optional',
    allowInMaintenance: true,
    handler: async ({ reply, auth }) => {
      if (auth?.sessionId) await c.sessions.revoke(auth.user.id, auth.sessionId);
      clearSessionCookie(reply, c.config);
      return undefined;
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/verify-email',
    auth: 'optional',
    body: tokenSchema,
    rateLimit: { name: 'auth:verify', limit: 30, windowMs: 15 * MIN },
    handler: async ({ body, ip }) => {
      const user = await c.auth.verifyEmail(body.token, ip);
      return { verified: true, email: user.email };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/resend-verification',
    auth: 'user',
    rateLimit: { name: 'auth:resend', limit: 10, windowMs: 60 * MIN, by: 'user' },
    handler: async ({ auth }) => {
      await c.auth.sendVerification(auth.user);
      const e = await c.settings.get('email');
      return { sent: true, cooldownSeconds: e.resendCooldownSeconds };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/forgot-password',
    auth: 'public',
    allowInMaintenance: true,
    body: requestEmailSchema,
    rateLimit: { name: 'auth:forgot', limit: 5, windowMs: 15 * MIN },
    handler: async ({ body, ip }) => {
      await c.auth.requestPasswordReset(body.email, ip);
      return { sent: true };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/reset-password',
    auth: 'public',
    allowInMaintenance: true,
    body: resetPasswordSchema,
    rateLimit: { name: 'auth:reset', limit: 10, windowMs: 15 * MIN },
    handler: async ({ body, ip }) => {
      await c.auth.resetPassword(body.token, body.password, ip);
      return { reset: true };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/confirm-email-change',
    auth: 'optional',
    body: tokenSchema,
    rateLimit: { name: 'auth:email-change', limit: 10, windowMs: 15 * MIN },
    handler: async ({ body, ip }) => {
      const user = await c.auth.confirmEmailChange(body.token, ip);
      return { changed: true, email: user.email };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/magic-link/request',
    auth: 'public',
    body: requestEmailSchema,
    rateLimit: { name: 'auth:magic', limit: 5, windowMs: 15 * MIN },
    handler: async ({ body, ip }) => {
      await c.auth.requestMagicLink(body.email, ip);
      return { sent: true };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/magic-link/consume',
    auth: 'public',
    body: tokenSchema,
    rateLimit: { name: 'auth:magic-consume', limit: 20, windowMs: 15 * MIN },
    handler: async ({ req, reply, body }) => {
      const r = await c.auth.consumeMagicLink(body.token, sessionMeta(req, c));
      setSessionCookie(reply, c.config, r.token, r.session.expiresAt);
      return meResponse(c, r.user);
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/auth/password-strength',
    auth: 'public',
    body: z.object({ password: z.string().max(256), inputs: z.array(z.string().max(254)).max(5).default([]) }),
    rateLimit: { name: 'auth:strength', limit: 120, windowMs: MIN },
    handler: async ({ body }) => passwordStrength(body.password, body.inputs),
  });
}
