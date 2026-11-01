import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { route } from '../../http/route.js';
import { settingSchemas, type SettingKey } from '../../services/settings/defaults.js';

const keys = Object.keys(settingSchemas) as [SettingKey, ...SettingKey[]];

export function adminSettingsRoutes(app: FastifyInstance, c: Container) {
  route(app, c, { method: 'GET', url: '/api/admin/settings', auth: { permission: 'admin:settings:read' }, allowInMaintenance: true, handler: async () => c.settings.all() });
  route(app, c, {
    method: 'PUT',
    url: '/api/admin/settings/:key',
    auth: { permission: 'admin:settings:write' },
    allowInMaintenance: true,
    params: z.object({ key: z.enum(keys) }),
    body: z.record(z.string(), z.unknown()),
    handler: async ({ params, body, auth, ip }) => {
      const value = await c.settings.patch(params.key, body as never, auth.user.id);
      if (params.key === 'features') c.entitlements.invalidate();
      await c.audit.log({ actorId: auth.user.id, action: 'settings.updated', targetType: 'setting', targetId: params.key, ip, metadata: { fields: Object.keys(body) } });
      return value;
    },
  });
}
