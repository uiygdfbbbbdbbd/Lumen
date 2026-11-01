import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changeEmailSchema,
  changePasswordSchema,
  LumenError,
  onboardingPatchSchema,
  profilePatchSchema,
  totpConfirmSchema,
  totpDisableSchema,
  type LimitKey,
} from '@lumen/shared';
import type { Container } from '../container.js';
import { clearSessionCookie } from '../http/cookies.js';
import { route, uuidParams } from '../http/route.js';
import { describeUserAgent } from '../services/auth/geo.js';
import { dayKey, nextUtcMidnight } from '../services/entitlements/entitlements.service.js';
import { meResponse } from './auth.routes.js';

const cropSchema = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });

export function meRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/me',
    auth: 'user',
    allowInMaintenance: true,
    handler: async ({ auth }) => meResponse(c, auth.user),
  });

  route(app, c, {
    method: 'PATCH',
    url: '/api/me/profile',
    auth: 'user',
    body: profilePatchSchema,
    handler: async ({ auth, body }) => meResponse(c, await c.users.updateProfile(auth.user, body)),
  });

  route(app, c, {
    method: 'PATCH',
    url: '/api/me/onboarding',
    auth: 'user',
    body: onboardingPatchSchema,
    handler: async ({ auth, body }) => meResponse(c, await c.users.patchOnboarding(auth.user, body)),
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/avatar',
    auth: 'user',
    rateLimit: { name: 'me:avatar', limit: 20, windowMs: 3600_000, by: 'user' },
    handler: async ({ req, auth }) => {
      if (!req.isMultipart()) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Upload the image as multipart/form-data.');
      const file = await req.file();
      if (!file) throw new LumenError('VALIDATION_FAILED', 'No file uploaded.');
      const buf = await file.toBuffer();
      const cropField = file.fields.crop as { value?: string } | undefined;
      let crop;
      if (cropField?.value) {
        const parsed = cropSchema.safeParse(JSON.parse(cropField.value));
        if (!parsed.success) throw new LumenError('VALIDATION_FAILED', 'Invalid crop rectangle.');
        crop = parsed.data;
      }
      return meResponse(c, await c.users.setAvatar(auth.user, buf, crop));
    },
  });

  route(app, c, {
    method: 'DELETE',
    url: '/api/me/avatar',
    auth: 'user',
    handler: async ({ auth }) => meResponse(c, await c.users.removeAvatar(auth.user)),
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/password',
    auth: 'user',
    body: changePasswordSchema,
    rateLimit: { name: 'me:password', limit: 10, windowMs: 15 * 60_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      await c.auth.changePassword(auth.user, body.currentPassword, body.newPassword, auth.sessionId, ip);
      return { changed: true };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/email',
    auth: 'user',
    body: changeEmailSchema,
    rateLimit: { name: 'me:email', limit: 5, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      await c.auth.requestEmailChange(auth.user, body.newEmail, body.password, ip);
      return { sent: true };
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/sessions',
    auth: 'user',
    handler: async ({ auth }) => {
      const rows = await c.sessions.list(auth.user.id);
      return {
        items: rows.map((s) => ({
          id: s.id,
          current: s.id === auth.sessionId,
          userAgent: s.userAgent,
          device: describeUserAgent(s.userAgent),
          ip: s.ip,
          location: s.location,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
        })),
      };
    },
  });

  route(app, c, {
    method: 'DELETE',
    url: '/api/me/sessions/:id',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params, reply, ip }) => {
      const ok = await c.sessions.revoke(auth.user.id, params.id);
      if (!ok) throw new LumenError('NOT_FOUND', 'Session not found.');
      await c.audit.log({ actorId: auth.user.id, action: 'auth.session_revoked', targetType: 'session', targetId: params.id, ip });
      if (params.id === auth.sessionId) clearSessionCookie(reply, c.config);
      return undefined;
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/sessions/revoke-all',
    auth: 'user',
    body: z.object({ keepCurrent: z.boolean().default(false) }),
    handler: async ({ auth, body, reply, ip }) => {
      const n = await c.sessions.revokeAll(auth.user.id, body.keepCurrent ? auth.sessionId : null);
      await c.audit.log({ actorId: auth.user.id, action: 'auth.sessions_revoked_all', targetType: 'user', targetId: auth.user.id, ip, metadata: { count: n } });
      if (!body.keepCurrent) clearSessionCookie(reply, c.config);
      return { revoked: n };
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/login-history',
    auth: 'user',
    handler: async ({ auth }) => {
      const rows = await c.auth.loginHistory(auth.user.id);
      return {
        items: rows.map((r) => ({
          id: r.id,
          success: r.success,
          reason: r.reason,
          method: r.method,
          ip: r.ip,
          userAgent: r.userAgent,
          device: describeUserAgent(r.userAgent),
          location: r.location,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/2fa/setup',
    auth: 'user',
    rateLimit: { name: 'me:2fa', limit: 10, windowMs: 15 * 60_000, by: 'user' },
    handler: async ({ auth }) => c.totp.beginSetup(auth.user),
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/2fa/confirm',
    auth: 'user',
    body: totpConfirmSchema,
    rateLimit: { name: 'me:2fa-confirm', limit: 10, windowMs: 15 * 60_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      const recoveryCodes = await c.totp.confirmSetup(auth.user, body.code);
      await c.audit.log({ actorId: auth.user.id, action: 'auth.2fa_enabled', targetType: 'user', targetId: auth.user.id, ip });
      return { enabled: true, recoveryCodes };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/2fa/disable',
    auth: 'user',
    body: totpDisableSchema,
    rateLimit: { name: 'me:2fa-disable', limit: 10, windowMs: 15 * 60_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      if (!auth.user.totpEnabled) throw new LumenError('CONFLICT', 'Two-factor authentication is not enabled.');
      if (!auth.user.passwordHash || !(await c.hasher.verify(auth.user.passwordHash, body.password))) {
        throw new LumenError('INVALID_CREDENTIALS', 'Password is incorrect.');
      }
      if (!(await c.totp.verifyAndRecord(auth.user, body.code))) throw new LumenError('INVALID_TWO_FACTOR_CODE', 'That code is not valid.');
      await c.totp.disable(auth.user.id);
      await c.audit.log({ actorId: auth.user.id, action: 'auth.2fa_disabled', targetType: 'user', targetId: auth.user.id, ip });
      return { enabled: false };
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/2fa/recovery-codes',
    auth: 'user',
    body: totpConfirmSchema,
    rateLimit: { name: 'me:2fa-codes', limit: 5, windowMs: 15 * 60_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      if (!auth.user.totpEnabled) throw new LumenError('CONFLICT', 'Two-factor authentication is not enabled.');
      if (!(await c.totp.verifyAndRecord(auth.user, body.code))) throw new LumenError('INVALID_TWO_FACTOR_CODE', 'That code is not valid.');
      const recoveryCodes = await c.totp.regenerateRecoveryCodes(auth.user.id);
      await c.audit.log({ actorId: auth.user.id, action: 'auth.recovery_codes_regenerated', targetType: 'user', targetId: auth.user.id, ip });
      return { recoveryCodes };
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/2fa',
    auth: 'user',
    handler: async ({ auth }) => ({
      enabled: auth.user.totpEnabled,
      recoveryCodesRemaining: auth.user.totpEnabled ? await c.totp.remainingRecoveryCodes(auth.user.id) : 0,
    }),
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/delete',
    auth: 'user',
    body: z.object({ password: z.string().max(256).optional(), confirm: z.literal('DELETE') }),
    rateLimit: { name: 'me:delete', limit: 5, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, body, ip }) => {
      const u = await c.users.scheduleDeletion(auth.user, body.password, ip);
      await c.sessions.revokeAll(u.id, auth.sessionId);
      return meResponse(c, u);
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/me/delete/cancel',
    auth: 'user',
    handler: async ({ auth, ip }) => meResponse(c, await c.users.cancelDeletion(auth.user, ip)),
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/export',
    auth: 'user',
    rateLimit: { name: 'me:export', limit: 5, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, reply, ip }) => {
      const zip = await c.users.exportData(auth.user);
      await c.audit.log({ actorId: auth.user.id, action: 'account.exported', targetType: 'user', targetId: auth.user.id, ip });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="lumen-export-${dayKey(c.now())}.zip"`)
        .send(Buffer.from(zip));
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/usage',
    auth: 'user',
    handler: async ({ auth }) => {
      const ent = auth.entitlements;
      const metrics: { metric: string; limit: LimitKey }[] = [
        { metric: 'messages', limit: 'messagesPerDay' },
        { metric: 'tokens', limit: 'tokensPerDay' },
        { metric: 'images', limit: 'imageGenPerDay' },
      ];
      const usage = await Promise.all(
        metrics.map(async (m) => ({ metric: m.metric, used: await c.entitlements.usage(auth.user.id, m.metric), limit: ent.limits[m.limit] })),
      );
      return { tierId: ent.tierId, limits: ent.limits, usage, resetAt: nextUtcMidnight(c.now()).toISOString() };
    },
  });
}
