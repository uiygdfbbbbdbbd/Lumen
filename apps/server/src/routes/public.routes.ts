import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LumenError } from '@lumen/shared';
import type { Container } from '../container.js';
import { safeBody } from '../http/stream.js';
import { route } from '../http/route.js';
import { sql } from 'drizzle-orm';

export function publicRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/health',
    auth: 'public',
    allowInMaintenance: true,
    handler: async () => ({ status: 'ok' }),
  });

  route(app, c, {
    method: 'GET',
    url: '/api/health/ready',
    auth: 'public',
    allowInMaintenance: true,
    handler: async ({ reply }) => {
      const checks: Record<string, 'ok' | 'error' | 'disabled'> = { database: 'ok', redis: 'disabled' };
      try {
        await c.db.execute(sql`select 1`);
      } catch {
        checks.database = 'error';
      }
      if (c.redis) {
        try {
          await c.redis.ping();
          checks.redis = 'ok';
        } catch {
          checks.redis = 'error';
        }
      }
      const healthy = !Object.values(checks).includes('error');
      return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/public/config',
    auth: 'public',
    allowInMaintenance: true,
    handler: async () => {
      const s = await c.settings.all();
      return {
        branding: {
          productName: s.branding.productName,
          tagline: s.branding.tagline,
          accentColor: s.branding.accentColor,
          loginCopy: s.branding.loginCopy,
          tosUrl: s.branding.tosUrl,
          privacyUrl: s.branding.privacyUrl,
          supportEmail: s.branding.supportEmail,
        },
        signup: {
          mode: s.signup.mode,
          requireVerification: s.signup.requireVerification,
          captcha: s.signup.captcha,
          captchaSiteKey: s.signup.captchaSiteKey,
          minimumAge: s.signup.minimumAge,
        },
        auth: {
          magicLink: s.security.magicLinkEnabled,
          passkeys: s.security.passkeysEnabled,
          oauth: [
            c.config.OAUTH_GOOGLE_CLIENT_ID ? 'google' : null,
            c.config.OAUTH_GITHUB_CLIENT_ID ? 'github' : null,
          ].filter(Boolean),
        },
        maintenance: s.maintenance,
        legal: { tosVersion: s.legal.tosVersion, cookieConsent: s.legal.cookieConsent },
      };
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/avatars/:userId/:file',
    auth: 'public',
    params: z.object({ userId: z.string().uuid(), file: z.string().regex(/^[A-Za-z0-9_-]{8,32}\.webp$/) }),
    handler: async ({ params, reply }) => {
      const obj = await c.storage.get(`avatars/${params.userId}/${params.file}`);
      if (!obj) throw new LumenError('NOT_FOUND', 'Avatar not found.');
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(safeBody(obj.body, reply, c.log as never));
    },
  });
}
