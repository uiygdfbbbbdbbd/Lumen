import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LumenError, userPreferencesSchema } from '@lumen/shared';
import { eq } from 'drizzle-orm';
import type { Container } from '../container.js';
import { route } from '../http/route.js';
import { users } from '../db/schema/index.js';

export function modelRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/models',
    auth: 'user',
    handler: async ({ auth }) => ({ items: await c.catalog.listForUser(auth.user, auth.entitlements) }),
  });

  route(app, c, {
    method: 'GET',
    url: '/api/me/preferences',
    auth: 'user',
    handler: async ({ auth }) => userPreferencesSchema.parse(auth.user.preferences ?? {}),
  });

  route(app, c, {
    method: 'PATCH',
    url: '/api/me/preferences',
    auth: 'user',
    body: userPreferencesSchema,
    handler: async ({ auth, body }) => {
      const merged = userPreferencesSchema.parse({ ...(auth.user.preferences ?? {}), ...body });
      await c.db.update(users).set({ preferences: merged }).where(eq(users.id, auth.user.id));
      return merged;
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/assets/icons/:file',
    auth: 'public',
    params: z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{8,32}\.webp$/) }),
    handler: async ({ params, reply }) => {
      const obj = await c.storage.get(`icons/${params.file}`);
      if (!obj) throw new LumenError('NOT_FOUND', 'Icon not found.');
      return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(obj.body);
    },
  });
}
