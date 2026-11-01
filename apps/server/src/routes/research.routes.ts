import type { FastifyInstance } from 'fastify';
import { startResearchSchema } from '@lumen/shared';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';

export function researchRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'POST',
    url: '/api/conversations/:id/research',
    auth: 'user',
    feature: 'deepResearch',
    params: uuidParams,
    body: startResearchSchema,
    rateLimit: { name: 'research:start', limit: 10, windowMs: 60 * 60_000, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(202).send(await c.research.start(auth.user, auth.entitlements, params.id, body)),
  });
  route(app, c, { method: 'GET', url: '/api/research/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.research.get(auth.user, params.id) });
  route(app, c, {
    method: 'POST',
    url: '/api/research/:id/cancel',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => ({ cancelled: await c.research.cancel(auth.user, { runId: params.id }) }),
  });
}
