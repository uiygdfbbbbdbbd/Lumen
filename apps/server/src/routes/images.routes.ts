import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASPECT_RATIOS } from '@lumen/llm';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';

export function imageRoutes(app: FastifyInstance, c: Container) {
  route(app, c, { method: 'GET', url: '/api/images/models', auth: 'user', handler: async ({ auth }) => ({ items: await c.images.models(auth.user) }) });
  route(app, c, {
    method: 'GET',
    url: '/api/images',
    auth: 'user',
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(40), before: z.string().datetime().optional(), ids: z.string().max(2000).optional() }),
    handler: async ({ auth, query }) => ({ items: query.ids ? await c.images.byIds(auth.user, query.ids.split(',').filter((id) => /^[0-9a-f-]{36}$/.test(id))) : await c.images.list(auth.user, query) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/images',
    auth: 'user',
    feature: 'imageGeneration',
    body: z.object({
      prompt: z.string().trim().min(1).max(4000),
      aspectRatio: z.enum(ASPECT_RATIOS).default('1:1'),
      n: z.number().int().min(1).max(4).default(1),
      modelId: z.string().max(200).optional(),
      negativePrompt: z.string().max(1000).optional(),
      seed: z.number().int().min(0).max(2 ** 31).optional(),
    }),
    rateLimit: { name: 'images:generate', limit: 20, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, body, reply }) => reply.code(201).send({ items: await c.images.generate(auth.user, auth.entitlements, body) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/images/:id/variations',
    auth: 'user',
    feature: 'imageGeneration',
    params: uuidParams,
    body: z.object({ n: z.number().int().min(1).max(4).default(2) }),
    rateLimit: { name: 'images:generate', limit: 20, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(201).send({ items: await c.images.variations(auth.user, auth.entitlements, params.id, body.n) }),
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/images/:id',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      await c.images.delete(auth.user, params.id);
    },
  });
}
