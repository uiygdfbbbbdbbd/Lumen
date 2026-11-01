import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LumenError } from '@lumen/shared';
import type { Container } from '../container.js';
import { route, uuidParams } from '../http/route.js';
import { ARTIFACT_TYPES } from '../db/schema/index.js';
import { serializeArtifact } from '../services/artifacts/artifact.service.js';
import { markdownToDocx, slidesToPptx } from '../services/artifacts/export.js';

const verParams = z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) });
const keyParams = z.object({ id: z.string().uuid(), key: z.string().regex(/^[\w.:-]{1,128}$/) });

export function artifactRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/artifacts',
    auth: 'user',
    query: z.object({ type: z.enum(ARTIFACT_TYPES).optional(), q: z.string().max(200).optional(), conversationId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(60) }),
    handler: async ({ auth, query }) => ({ items: await c.artifacts.list(auth.user, query) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/artifacts',
    auth: 'user',
    body: z.object({ type: z.enum(ARTIFACT_TYPES), title: z.string().min(1).max(200), content: z.string().max(1024 * 1024), language: z.string().max(40).nullable().optional(), projectId: z.string().uuid().nullable().optional() }),
    bodyLimit: 2 * 1024 * 1024,
    handler: async ({ auth, body, reply }) => {
      if (body.projectId) await c.projects.require(auth.user, body.projectId, 'editor');
      return reply.code(201).send(serializeArtifact(await c.artifacts.create(auth.user, { ...body, source: 'user' })));
    },
  });
  route(app, c, {
    method: 'GET',
    url: '/api/conversations/:id/artifacts',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      await c.conversations.get(auth.user, params.id);
      return { items: await c.artifacts.forConversation(auth.user, params.id) };
    },
  });
  route(app, c, {
    method: 'GET',
    url: '/api/artifacts/:id',
    auth: 'user',
    params: uuidParams,
    query: z.object({ version: z.coerce.number().int().min(1).optional() }),
    handler: async ({ auth, params, query }) => {
      const a = await c.artifacts.get(auth.user, params.id);
      const v = await c.artifacts.content(params.id, query.version);
      return { ...serializeArtifact(a, v.content), viewingVersion: v.version, versionLabel: v.label };
    },
  });
  route(app, c, { method: 'GET', url: '/api/artifacts/:id/versions', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => ({ items: await c.artifacts.versions(auth.user, params.id) }) });
  route(app, c, {
    method: 'GET',
    url: '/api/artifacts/:id/diff',
    auth: 'user',
    params: uuidParams,
    query: z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }),
    handler: async ({ auth, params, query }) => ({ patch: await c.artifacts.diff(auth.user, params.id, query.from, query.to) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/artifacts/:id/versions',
    auth: 'user',
    params: uuidParams,
    body: z.object({ content: z.string().max(1024 * 1024), basedOn: z.number().int().min(1).optional(), label: z.string().max(80).nullable().optional() }),
    bodyLimit: 2 * 1024 * 1024,
    handler: async ({ auth, params, body }) => serializeArtifact(await c.artifacts.rewrite(auth.user, params.id, body.content, 'user', { basedOn: body.basedOn, label: body.label ?? null })),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/artifacts/:id/edit',
    auth: 'user',
    params: uuidParams,
    body: z.object({ oldStr: z.string().min(1).max(200_000), newStr: z.string().max(200_000) }),
    handler: async ({ auth, params, body }) => serializeArtifact(await c.artifacts.edit(auth.user, params.id, body.oldStr, body.newStr, 'user')),
  });
  route(app, c, { method: 'POST', url: '/api/artifacts/:id/versions/:version/restore', auth: 'user', params: verParams, handler: async ({ auth, params }) => serializeArtifact(await c.artifacts.restore(auth.user, params.id, params.version)) });
  route(app, c, {
    method: 'PATCH',
    url: '/api/artifacts/:id/versions/:version',
    auth: 'user',
    params: verParams,
    body: z.object({ label: z.string().max(80).nullable() }),
    handler: async ({ auth, params, body }) => c.artifacts.labelVersion(auth.user, params.id, params.version, body.label),
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/artifacts/:id',
    auth: 'user',
    params: uuidParams,
    body: z.object({ title: z.string().min(1).max(200).optional(), projectId: z.string().uuid().nullable().optional() }).strict(),
    handler: async ({ auth, params, body }) => serializeArtifact(await c.artifacts.patch(auth.user, params.id, body)),
  });
  route(app, c, { method: 'DELETE', url: '/api/artifacts/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.artifacts.delete(auth.user, params.id) });
  route(app, c, { method: 'POST', url: '/api/artifacts/:id/fork', auth: 'user', params: uuidParams, handler: async ({ auth, params, reply }) => reply.code(201).send(serializeArtifact(await c.artifacts.fork(auth.user, params.id))) });
  route(app, c, {
    method: 'POST',
    url: '/api/artifacts/:id/publish',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params, ip }) => serializeArtifact(await c.artifacts.publish(auth.user, auth.entitlements, params.id, ip)),
  });
  route(app, c, { method: 'POST', url: '/api/artifacts/:id/unpublish', auth: 'user', params: uuidParams, handler: async ({ auth, params, ip }) => serializeArtifact(await c.artifacts.unpublish(auth.user, params.id, ip)) });
  route(app, c, {
    method: 'GET',
    url: '/api/artifacts/:id/export',
    auth: 'user',
    params: uuidParams,
    query: z.object({ format: z.enum(['docx', 'pptx']), version: z.coerce.number().int().min(1).optional() }),
    rateLimit: { name: 'artifacts:export', limit: 30, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, params, query, reply }) => {
      const a = await c.artifacts.get(auth.user, params.id);
      const { content } = await c.artifacts.content(params.id, query.version);
      const safe = a.title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'artifact';
      if (query.format === 'docx') {
        if (!['markdown', 'latex', 'code'].includes(a.type)) throw new LumenError('VALIDATION_FAILED', 'Word export is available for documents.');
        return reply
          .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          .header('content-disposition', `attachment; filename="${safe}.docx"`)
          .send(await markdownToDocx(a.title, a.type === 'code' ? `\`\`\`\n${content}\n\`\`\`` : content));
      }
      if (!['slides', 'markdown'].includes(a.type)) throw new LumenError('VALIDATION_FAILED', 'PowerPoint export is available for slide decks.');
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        .header('content-disposition', `attachment; filename="${safe}.pptx"`)
        .send(await slidesToPptx(a.title, content));
    },
  });

  // Mini-app APIs (called by the sandboxed runtime through the parent window's bridge).
  route(app, c, { method: 'GET', url: '/api/artifacts/:id/storage', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => ({ items: await c.artifacts.storageList(auth.user, params.id) }) });
  route(app, c, {
    method: 'GET',
    url: '/api/artifacts/:id/storage/:key',
    auth: 'user',
    params: keyParams,
    query: z.object({ shared: z.enum(['true', 'false']).default('false') }),
    handler: async ({ auth, params, query }) => ({ value: await c.artifacts.storageGet(auth.user, params.id, params.key, query.shared === 'true') }),
  });
  route(app, c, {
    method: 'PUT',
    url: '/api/artifacts/:id/storage/:key',
    auth: 'user',
    params: keyParams,
    body: z.object({ value: z.unknown(), shared: z.boolean().default(false) }),
    rateLimit: { name: 'artifacts:storage', limit: 300, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, params, body }) => c.artifacts.storageSet(auth.user, params.id, params.key, body.value ?? null, body.shared),
  });
  route(app, c, { method: 'DELETE', url: '/api/artifacts/:id/storage/:key', auth: 'user', params: keyParams, handler: async ({ auth, params }) => c.artifacts.storageDelete(auth.user, params.id, params.key) });
  route(app, c, {
    method: 'POST',
    url: '/api/artifacts/:id/ai',
    auth: 'user',
    feature: 'chat',
    params: uuidParams,
    body: z.object({ prompt: z.string().min(1).max(20_000), system: z.string().max(4000).optional(), maxTokens: z.number().int().min(1).max(4096).optional() }),
    rateLimit: { name: 'artifacts:ai', limit: 20, windowMs: 60_000, by: 'user' },
    handler: async ({ auth, params, body }) => c.artifacts.ai(auth.user, auth.entitlements, params.id, body),
  });

  // Public, read-only view of published artifacts (noindex).
  route(app, c, {
    method: 'GET',
    url: '/api/public/artifacts/:slug',
    auth: 'public',
    params: z.object({ slug: z.string().max(64) }),
    rateLimit: { name: 'public:artifact', limit: 120, windowMs: 60_000 },
    handler: async ({ params, reply }) => {
      const a = await c.artifacts.bySlug(params.slug);
      const { content } = await c.artifacts.content(a.id);
      reply.header('x-robots-tag', 'noindex, nofollow');
      return { id: a.id, type: a.type, title: a.title, language: a.language, version: a.currentVersion, content, publishedAt: a.publishedAt?.toISOString() ?? null };
    },
  });
  route(app, c, { method: 'POST', url: '/api/public/artifacts/:slug/fork', auth: 'user', params: z.object({ slug: z.string().max(64) }), handler: async ({ auth, params, reply }) => reply.code(201).send(serializeArtifact(await c.artifacts.forkPublic(auth.user, params.slug))) });
}
