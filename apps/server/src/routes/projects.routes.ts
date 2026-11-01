import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { patchOf } from '@lumen/shared';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';
import { serializeFile } from '../services/files/file.service.js';
import { projectExportSchema, projectInputSchema } from '../services/projects/project.service.js';
import { PROJECT_TEMPLATES } from '../services/projects/templates.js';

export function projectRoutes(app: FastifyInstance, c: Container) {
  route(app, c, { method: 'GET', url: '/api/project-templates', auth: 'user', handler: async () => ({ items: PROJECT_TEMPLATES }) });
  route(app, c, {
    method: 'GET',
    url: '/api/projects',
    auth: 'user',
    query: z.object({ archived: z.enum(['true', 'false']).default('false') }),
    handler: async ({ auth, query }) => ({ items: await c.projects.list(auth.user, query.archived === 'true') }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/projects',
    auth: 'user',
    body: projectInputSchema,
    rateLimit: { name: 'projects:create', limit: 60, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, body, ip, reply }) => reply.code(201).send(await c.projects.create(auth.user, body, ip)),
  });
  route(app, c, { method: 'GET', url: '/api/projects/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.projects.dashboard(auth.user, params.id) });
  route(app, c, {
    method: 'PATCH',
    url: '/api/projects/:id',
    auth: 'user',
    params: uuidParams,
    body: patchOf(projectInputSchema.omit({ templateId: true }).extend({ archived: z.boolean() })),
    handler: async ({ auth, params, body }) => c.projects.update(auth.user, params.id, body),
  });
  route(app, c, { method: 'DELETE', url: '/api/projects/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params, ip }) => c.projects.delete(auth.user, params.id, ip) });
  route(app, c, { method: 'POST', url: '/api/projects/:id/duplicate', auth: 'user', params: uuidParams, handler: async ({ auth, params, reply }) => reply.code(201).send(await c.projects.duplicate(auth.user, params.id)) });
  route(app, c, {
    method: 'GET',
    url: '/api/projects/:id/export',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params, reply }) => {
      const data = await c.projects.export(auth.user, params.id);
      return reply.header('content-disposition', `attachment; filename="${data.project.name.replace(/[^\w.-]+/g, '_')}.lumen-project.json"`).send(data);
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/projects/import',
    auth: 'user',
    body: projectExportSchema,
    bodyLimit: 20 * 1024 * 1024,
    handler: async ({ auth, body, ip, reply }) => {
      const p = await c.projects.create(auth.user, body.project, ip);
      for (const n of body.notes) await c.files.createNote(auth.user, auth.entitlements, p.id, n.name.replace(/\.md$/, ''), n.text);
      for (const u of body.urls) await c.files.addUrl(auth.user, auth.entitlements, p.id, u.url, u.recrawlHours);
      return reply.code(201).send(p);
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/projects/:id/notes',
    auth: 'user',
    feature: 'fileUpload',
    params: uuidParams,
    body: z.object({ title: z.string().trim().min(1).max(150), text: z.string().min(1).max(2_000_000) }),
    bodyLimit: 4 * 1024 * 1024,
    handler: async ({ auth, params, body, reply }) => reply.code(201).send(serializeFile(await c.files.createNote(auth.user, auth.entitlements, params.id, body.title, body.text))),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/projects/:id/urls',
    auth: 'user',
    feature: 'fileUpload',
    params: uuidParams,
    body: z.object({ url: z.string().url().max(2000), recrawlHours: z.number().int().min(1).max(24 * 365).nullable().default(null) }),
    rateLimit: { name: 'projects:url', limit: 60, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, params, body, reply }) => reply.code(201).send(serializeFile(await c.files.addUrl(auth.user, auth.entitlements, params.id, body.url, body.recrawlHours))),
  });
}
