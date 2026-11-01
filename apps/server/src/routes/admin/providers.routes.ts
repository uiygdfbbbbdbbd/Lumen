import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aliasInputSchema, LumenError, modelInputSchema, modelPatchSchema, providerInputSchema, providerKeyInputSchema, providerKeyPatchSchema, providerPatchSchema } from '@lumen/shared';
import { PROVIDER_PRESETS } from '@lumen/llm';
import type { Container } from '../../container.js';
import { route, uuidParams } from '../../http/route.js';
import { storeIcon } from '../../services/providers/icons.js';

const read = { permission: 'admin:providers:read' } as const;
const write = { permission: 'admin:providers:write' } as const;
const keyParams = z.object({ id: z.string().uuid(), keyId: z.string().uuid() });

async function readUpload(req: import('fastify').FastifyRequest): Promise<Buffer> {
  if (!req.isMultipart()) throw new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Upload the icon as multipart/form-data.');
  const file = await req.file();
  if (!file) throw new LumenError('VALIDATION_FAILED', 'No file uploaded.');
  return file.toBuffer();
}

export function adminProviderRoutes(app: FastifyInstance, c: Container) {
  route(app, c, { method: 'GET', url: '/api/admin/provider-presets', auth: read, handler: async () => ({ presets: PROVIDER_PRESETS, allowPrivate: c.config.ALLOW_PRIVATE_PROVIDER_URLS }) });
  route(app, c, { method: 'GET', url: '/api/admin/providers', auth: read, handler: async () => ({ items: await c.providers.list() }) });
  route(app, c, { method: 'GET', url: '/api/admin/providers/:id', auth: read, params: uuidParams, handler: async ({ params }) => c.providers.get(params.id) });

  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers',
    auth: write,
    body: providerInputSchema,
    rateLimit: { name: 'admin:providers', limit: 60, windowMs: 60_000, by: 'user' },
    handler: async ({ body, auth, ip, reply }) => reply.code(201).send(await c.providers.create(body, auth.user.id, ip)),
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/admin/providers/:id',
    auth: write,
    params: uuidParams,
    body: providerPatchSchema,
    handler: async ({ params, body, auth, ip }) => c.providers.update(params.id, body, auth.user.id, ip),
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/admin/providers/:id',
    auth: write,
    params: uuidParams,
    handler: async ({ params, auth, ip }) => c.providers.delete(params.id, auth.user.id, ip),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers/:id/icon',
    auth: write,
    params: uuidParams,
    handler: async ({ params, req }) => c.providers.setIconFromUpload(params.id, await readUpload(req)),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers/:id/test',
    auth: write,
    params: uuidParams,
    rateLimit: { name: 'admin:provider-test', limit: 30, windowMs: 60_000, by: 'user' },
    handler: async ({ params, auth, ip }) => c.providers.testConnection(params.id, auth.user.id, ip),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers/:id/import-models',
    auth: write,
    params: uuidParams,
    body: z.object({ enable: z.boolean().default(false) }),
    handler: async ({ params, body, auth, ip }) => c.providers.importModels(params.id, auth.user.id, ip, body),
  });
  route(app, c, {
    method: 'GET',
    url: '/api/admin/providers/:id/remote-models',
    auth: read,
    params: uuidParams,
    handler: async ({ params }) => ({ items: await c.providers.listRemoteModels(params.id) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers/:id/keys',
    auth: write,
    params: uuidParams,
    body: providerKeyInputSchema,
    handler: async ({ params, body, auth, ip }) => {
      await c.providers.addKey(params.id, body, auth.user.id, ip);
      return c.providers.get(params.id);
    },
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/admin/providers/:id/keys/:keyId',
    auth: write,
    params: keyParams,
    body: providerKeyPatchSchema,
    handler: async ({ params, body, auth, ip }) => {
      await c.providers.updateKey(params.id, params.keyId, body, auth.user.id, ip);
      return c.providers.get(params.id);
    },
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/admin/providers/:id/keys/:keyId',
    auth: write,
    params: keyParams,
    handler: async ({ params, auth, ip }) => {
      await c.providers.deleteKey(params.id, params.keyId, auth.user.id, ip);
      return c.providers.get(params.id);
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/secrets/rotate',
    auth: { permission: 'admin:secrets:rotate' },
    handler: async ({ auth, ip }) => c.providers.rotateSecrets(auth.user.id, ip),
  });

  // Models
  route(app, c, {
    method: 'GET',
    url: '/api/admin/models',
    auth: read,
    query: z.object({ providerId: z.string().uuid().optional() }),
    handler: async ({ query }) => ({ items: await c.catalog.adminList(query.providerId) }),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/providers/:id/models',
    auth: write,
    params: uuidParams,
    body: modelInputSchema,
    handler: async ({ params, body, auth, ip, reply }) => reply.code(201).send(await c.catalog.create(params.id, body, auth.user.id, ip)),
  });
  route(app, c, {
    method: 'PATCH',
    url: '/api/admin/models/:id',
    auth: write,
    params: uuidParams,
    body: modelPatchSchema,
    handler: async ({ params, body, auth, ip }) => c.catalog.update(params.id, body, auth.user.id, ip),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/models/bulk',
    auth: write,
    body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500), enabled: z.boolean() }),
    handler: async ({ body, auth, ip }) => ({ updated: await c.catalog.bulkSetEnabled(body.ids, body.enabled, auth.user.id, ip) }),
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/admin/models/:id',
    auth: write,
    params: uuidParams,
    handler: async ({ params, auth, ip }) => c.catalog.delete(params.id, auth.user.id, ip),
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/models/:id/icon',
    auth: write,
    params: uuidParams,
    handler: async ({ params, req }) => {
      await c.catalog.get(params.id);
      const key = await storeIcon(c.storage, await readUpload(req));
      return c.catalog.serialize((await c.catalog.setIcon(params.id, key))!);
    },
  });

  // Aliases
  route(app, c, { method: 'GET', url: '/api/admin/model-aliases', auth: read, handler: async () => ({ items: await c.catalog.listAliases() }) });
  route(app, c, {
    method: 'PUT',
    url: '/api/admin/model-aliases',
    auth: write,
    body: aliasInputSchema,
    handler: async ({ body, auth, ip }) => {
      await c.catalog.upsertAlias(body.alias, body.modelId, body.description, auth.user.id, ip);
      return { items: await c.catalog.listAliases() };
    },
  });
  route(app, c, {
    method: 'DELETE',
    url: '/api/admin/model-aliases/:alias',
    auth: write,
    params: z.object({ alias: z.string().max(48) }),
    handler: async ({ params, auth, ip }) => c.catalog.deleteAlias(params.alias, auth.user.id, ip),
  });
}
