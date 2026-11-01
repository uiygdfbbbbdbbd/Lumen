import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createMemorySchema, listMemoriesQuerySchema, memoryImportPreviewSchema, memoryImportSchema, updateMemorySchema } from '@lumen/shared';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';

export function memoryRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/memories',
    auth: 'user',
    query: listMemoriesQuerySchema,
    handler: async ({ auth, query }) => ({ items: await c.memory.list(auth.user, query), enabled: await c.memory.enabledFor(auth.user) }),
  });
  route(app, c, {
    method: 'GET',
    url: '/api/memories/lookup',
    auth: 'user',
    query: z.object({ ids: z.string().max(4000) }),
    handler: async ({ auth, query }) => ({ items: await c.memory.byIds(auth.user, query.ids.split(',').filter((id) => /^[0-9a-f-]{36}$/.test(id))) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/memories',
    auth: 'user',
    feature: 'memory',
    body: createMemorySchema,
    rateLimit: { name: 'memory:write', limit: 120, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, body, reply }) => {
      const r = await c.memory.create(auth.user, body, { source: 'user' });
      return reply.code(r.deduplicated ? 200 : 201).send(r);
    },
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/memories/:id',
    auth: 'user',
    params: uuidParams,
    body: updateMemorySchema,
    handler: async ({ auth, params, body }) => c.memory.update(auth.user, params.id, body),
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/memories/:id',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      await c.memory.delete(auth.user, params.id);
    },
  });
  // "Forget everything" requires typing the confirmation phrase, so a stray request can't wipe memory.
  route(app, c, {
    method: 'POST',
    url: '/api/memories/forget-all',
    auth: 'user',
    body: z.object({ confirm: z.literal('forget everything') }),
    rateLimit: { name: 'memory:forget', limit: 5, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, ip }) => {
      const deleted = await c.memory.deleteAll(auth.user);
      await c.audit.log({ actorId: auth.user.id, action: 'memory.forget_all', targetType: 'user', targetId: auth.user.id, ip, metadata: { deleted } });
      return { deleted };
    },
  });
  route(app, c, { method: 'GET', url: '/api/memories/summary', auth: 'user', handler: async ({ auth }) => c.memory.summary(auth.user) });
  route(app, c, {
    method: 'POST',
    url: '/api/memories/consolidate',
    auth: 'user',
    feature: 'memory',
    rateLimit: { name: 'memory:consolidate', limit: 3, windowMs: 10 * 60_000, by: 'user' },
    handler: async ({ auth }) => c.memory.consolidate(auth.user),
  });
  route(app, c, {
    method: 'GET',
    url: '/api/memories/export',
    auth: 'user',
    handler: async ({ auth, reply }) => {
      const data = await c.memory.exportAll(auth.user);
      return reply.header('content-disposition', `attachment; filename="lumen-memories-${data.exportedAt.slice(0, 10)}.json"`).send(data);
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/memories/import/preview',
    auth: 'user',
    feature: 'memory',
    body: memoryImportPreviewSchema,
    bodyLimit: 512 * 1024,
    rateLimit: { name: 'memory:import', limit: 20, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, body }) => ({ entries: await c.memory.previewImport(auth.user, body.text) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/memories/import',
    auth: 'user',
    feature: 'memory',
    body: memoryImportSchema,
    bodyLimit: 1024 * 1024,
    rateLimit: { name: 'memory:import', limit: 20, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, body }) => {
      if (body.projectId) await c.projects.require(auth.user, body.projectId, 'viewer');
      return c.memory.importEntries(auth.user, body.entries, body.projectId ?? null);
    },
  });
}


