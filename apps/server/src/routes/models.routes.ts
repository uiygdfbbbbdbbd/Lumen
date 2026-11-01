import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LumenError, userPreferencesSchema } from '@lumen/shared';
import { eq, sql } from 'drizzle-orm';
import type { Container } from '../container.js';
import { isImageModel } from '../services/models/catalog.service.js';
import { safeBody } from '../http/stream.js';
import { route } from '../http/route.js';
import { users } from '../db/schema/index.js';

export function modelRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/models',
    auth: 'user',
    query: z.object({ kind: z.enum(['chat', 'image']).default('chat') }),
    handler: async ({ auth, query }) => ({ items: (await c.catalog.listForUser(auth.user, auth.entitlements)).filter((m) => isImageModel(m.capabilities) === (query.kind === 'image')) }),
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
      // Atomic merge in SQL: concurrent PATCHes touching different keys must not overwrite each other.
      const [row] = await c.db
        .update(users)
        .set({ preferences: sql`${users.preferences} || ${JSON.stringify(body)}::jsonb` })
        .where(eq(users.id, auth.user.id))
        .returning({ preferences: users.preferences });
      return userPreferencesSchema.parse(row?.preferences ?? {});
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
      return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(safeBody(obj.body, reply, c.log as never));
    },
  });
}
