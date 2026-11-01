import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LumenError } from '@lumen/shared';
import type { Container } from '../container.js';
import { safeBody } from '../http/stream.js';
import { route, uuidParams } from '../http/route.js';
import { serializeFile } from '../services/files/file.service.js';

const MAX_SIMPLE_UPLOAD = 50 * 1024 * 1024;
const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|text\/csv|text\/markdown|audio\/|video\/)/;

export function fileRoutes(app: FastifyInstance, c: Container) {
  // Raw chunk bodies for resumable uploads.
  app.addContentTypeParser('application/offset+octet-stream', { parseAs: 'buffer', bodyLimit: 9 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  route(app, c, {
    method: 'POST',
    url: '/api/files',
    auth: 'user',
    feature: 'fileUpload',
    bodyLimit: MAX_SIMPLE_UPLOAD + 1024 * 1024,
    rateLimit: { name: 'files:upload', limit: 120, windowMs: 3600_000, by: 'user' },
    handler: async ({ req, auth, reply }) => {
      if (!req.isMultipart()) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Upload files as multipart/form-data.');
      const file = await req.file({ limits: { fileSize: Math.min(MAX_SIMPLE_UPLOAD, auth.entitlements.limits.maxUploadBytes) + 1, files: 1 } });
      if (!file) throw new LumenError('VALIDATION_FAILED', 'No file uploaded.');
      const data = await file.toBuffer();
      if (file.file.truncated || data.length > auth.entitlements.limits.maxUploadBytes) {
        throw new LumenError('PAYLOAD_TOO_LARGE', `Files can be up to ${Math.round(auth.entitlements.limits.maxUploadBytes / 1024 / 1024)} MB on your plan.`);
      }
      const projectId = (file.fields.projectId as { value?: string } | undefined)?.value || null;
      if (projectId && !z.string().uuid().safeParse(projectId).success) throw new LumenError('VALIDATION_FAILED', 'Invalid project.');
      const row = await c.files.upload(auth.user, auth.entitlements, { name: file.filename, data, projectId });
      return reply.code(201).send(serializeFile(row));
    },
  });

  route(app, c, {
    method: 'POST',
    url: '/api/uploads',
    auth: 'user',
    feature: 'fileUpload',
    body: z.object({ name: z.string().min(1).max(500), size: z.number().int().min(1).max(100 * 1024 ** 3), mimeType: z.string().max(200).default('application/octet-stream'), projectId: z.string().uuid().nullable().optional() }),
    rateLimit: { name: 'files:upload', limit: 120, windowMs: 3600_000, by: 'user' },
    handler: async ({ auth, body, reply }) => reply.code(201).send(await c.files.createUploadSession(auth.user, auth.entitlements, body)),
  });
  route(app, c, { method: 'GET', url: '/api/uploads/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.files.uploadStatus(auth.user, params.id) });
  route(app, c, {
    method: 'PATCH',
    url: '/api/uploads/:id',
    auth: 'user',
    feature: 'fileUpload',
    params: uuidParams,
    bodyLimit: 9 * 1024 * 1024,
    handler: async ({ auth, params, req }) => {
      const offset = Number(req.headers['upload-offset']);
      if (!Number.isInteger(offset) || offset < 0) throw new LumenError('VALIDATION_FAILED', 'Upload-Offset header is required.');
      if (!Buffer.isBuffer(req.body)) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Send chunks as application/offset+octet-stream.');
      const r = await c.files.appendChunk(auth.user, auth.entitlements, params.id, offset, req.body);
      return { offset: r.offset, file: r.file ? serializeFile(r.file) : null };
    },
  });

  route(app, c, {
    method: 'GET',
    url: '/api/files',
    auth: 'user',
    query: z.object({ projectId: z.string().uuid().optional(), kind: z.string().max(20).optional(), q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(100), before: z.string().datetime().optional() }),
    handler: async ({ auth, query }) => ({ items: await c.files.list(auth.user, query) }),
  });
  route(app, c, { method: 'GET', url: '/api/files/storage', auth: 'user', handler: async ({ auth }) => c.files.storageSummary(auth.user, auth.entitlements) });
  route(app, c, { method: 'GET', url: '/api/files/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => serializeFile(await c.files.get(auth.user, params.id)) });
  route(app, c, {
    method: 'GET',
    url: '/api/files/:id/text',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      const f = await c.files.get(auth.user, params.id);
      return { text: (f.text ?? '').slice(0, 500_000), truncated: (f.text?.length ?? 0) > 500_000 };
    },
  });
  route(app, c, {
    method: 'GET',
    url: '/api/files/:id/content',
    auth: 'user',
    params: uuidParams,
    query: z.object({ download: z.enum(['0', '1']).default('0') }),
    handler: async ({ auth, params, query, reply }) => {
      const { file, obj } = await c.files.content(auth.user, params.id);
      const inline = query.download === '0' && INLINE_SAFE.test(file.mimeType);
      const type = file.mimeType.startsWith('text/') ? `${inline ? file.mimeType : 'application/octet-stream'}; charset=utf-8` : inline ? file.mimeType : 'application/octet-stream';
      return reply
        .header('content-type', type)
        .header('content-length', obj.size)
        .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
        .header('x-content-type-options', 'nosniff')
        // Even if a browser renders it, uploaded content can't run script or reach our origin's storage.
        .header('content-security-policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
        .header('cache-control', 'private, max-age=300')
        .send(safeBody(obj.body, reply, c.log as never));
    },
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/files/:id',
    auth: 'user',
    params: uuidParams,
    body: z.object({ name: z.string().min(1).max(200).optional(), projectId: z.string().uuid().nullable().optional() }).strict(),
    handler: async ({ auth, params, body }) => {
      let f = await c.files.get(auth.user, params.id, true);
      if (body.name) f = await c.files.rename(auth.user, params.id, body.name);
      if (body.projectId !== undefined) f = await c.files.move(auth.user, params.id, body.projectId);
      return serializeFile(f);
    },
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/files/:id',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      if (!(await c.files.delete(auth.user, [params.id]))) throw new LumenError('NOT_FOUND', 'File not found.');
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/files/bulk-delete',
    auth: 'user',
    body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
    handler: async ({ auth, body }) => ({ deleted: await c.files.delete(auth.user, body.ids) }),
  });
  route(app, c, { method: 'POST', url: '/api/files/:id/retry', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.files.retry(auth.user, params.id) });
  route(app, c, { method: 'GET', url: '/api/chunks/:id', auth: 'user', params: uuidParams, handler: async ({ auth, params }) => c.files.chunk(auth.user, params.id) });
  route(app, c, {
    method: 'PATCH',
    url: '/api/conversations/:id/files',
    auth: 'user',
    params: uuidParams,
    body: z.object({ fileIds: z.array(z.string().uuid()).min(1).max(50), mode: z.enum(['auto', 'inline', 'retrieval']) }),
    handler: async ({ auth, params, body }) => {
      await c.conversations.get(auth.user, params.id);
      await c.fileContext.setMode(params.id, body.fileIds, body.mode);
    },
  });
  route(app, c, {
    method: 'GET',
    url: '/api/conversations/:id/files',
    auth: 'user',
    params: uuidParams,
    handler: async ({ auth, params }) => {
      await c.conversations.get(auth.user, params.id);
      const ids = await c.fileContext.conversationFileIds(params.id);
      return { items: (await c.files.byIds(auth.user, ids).catch(() => [])).map(serializeFile) };
    },
  });
}
