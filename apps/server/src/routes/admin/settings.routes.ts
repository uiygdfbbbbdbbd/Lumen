import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { route } from '../../http/route.js';
import { settingSchemas, type SettingKey } from '../../services/settings/defaults.js';
import { SEARCH_KEY_AAD } from '../../services/web/web.service.js';

const keys = Object.keys(settingSchemas) as [SettingKey, ...SettingKey[]];

export function adminSettingsRoutes(app: FastifyInstance, c: Container) {
  route(app, c, {
    method: 'GET',
    url: '/api/admin/settings',
    auth: { permission: 'admin:settings:read' },
    allowInMaintenance: true,
    handler: async () => {
      const all = await c.settings.all();
      // Secrets are write-only: report whether one is set, never the (encrypted) value.
      const { apiKeyEncrypted, ...webSearch } = all.webSearch;
      return { ...all, webSearch: { ...webSearch, hasApiKey: Boolean(apiKeyEncrypted) } };
    },
  });
  route(app, c, {
    method: 'PUT',
    url: '/api/admin/settings/:key',
    auth: { permission: 'admin:settings:write' },
    allowInMaintenance: true,
    params: z.object({ key: z.enum(keys) }),
    body: z.record(z.string(), z.unknown()),
    handler: async ({ params, body, auth, ip }) => {
      if (params.key === 'webSearch') {
        delete (body as Record<string, unknown>).apiKeyEncrypted;
        delete (body as Record<string, unknown>).hasApiKey;
      }
      const value = await c.settings.patch(params.key, body as never, auth.user.id);
      if (params.key === 'features') c.entitlements.invalidate();
      await c.audit.log({ actorId: auth.user.id, action: 'settings.updated', targetType: 'setting', targetId: params.key, ip, metadata: { fields: Object.keys(body) } });
      if (params.key === 'webSearch') {
        const { apiKeyEncrypted, ...rest } = value as { apiKeyEncrypted: string | null };
        return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
      }
      return value;
    },
  });

  route(app, c, {
    method: 'PUT',
    url: '/api/admin/web-search/key',
    auth: { permission: 'admin:settings:write' },
    body: z.object({ apiKey: z.string().trim().min(8).max(500).nullable() }),
    handler: async ({ body, auth, ip }) => {
      await c.settings.patch('webSearch', { apiKeyEncrypted: body.apiKey ? c.box.encrypt(body.apiKey, SEARCH_KEY_AAD) : null } as never, auth.user.id);
      await c.audit.log({ actorId: auth.user.id, action: body.apiKey ? 'web_search.key_set' : 'web_search.key_cleared', targetType: 'setting', targetId: 'webSearch', ip });
      return { hasApiKey: Boolean(body.apiKey) };
    },
  });
  route(app, c, {
    method: 'POST',
    url: '/api/admin/web-search/test',
    auth: { permission: 'admin:settings:write' },
    body: z.object({ query: z.string().trim().min(1).max(200).default('open source') }),
    rateLimit: { name: 'admin:web-search-test', limit: 10, windowMs: 60_000, by: 'user' },
    handler: async ({ body }) => {
      const started = Date.now();
      const hits = await c.web.search(body.query, { count: 5 });
      return { ok: true, latencyMs: Date.now() - started, results: hits.map((h) => ({ title: h.title, url: h.url })) };
    },
  });
}
