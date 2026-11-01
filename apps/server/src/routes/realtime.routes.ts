import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { resolveAuth } from '../http/auth-context.js';

/**
 * Per-user WebSocket for cross-tab/device sync. Cookie-authenticated; the Origin must match the app
 * (browsers attach cookies to cross-site WebSocket handshakes, so this is our CSRF check here).
 */
export function realtimeRoutes(app: FastifyInstance, c: Container) {
  const allowed = new Set([new URL(c.config.PUBLIC_URL).origin, ...c.config.CORS_ORIGINS]);
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      socket.close(4403, 'origin not allowed');
      return;
    }
    if (!req.auth) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    const off = c.bus.subscribe(req.auth.user.id, (e) => socket.send(JSON.stringify(e)));
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on('close', () => {
      off();
      clearInterval(ping);
    });
    socket.on('message', () => {
      /* client messages are ignored; the channel is server -> client only */
    });
  });
  // Authenticate before the upgrade completes.
  app.addHook('preValidation', async (req, reply) => {
    if (req.routeOptions.url === '/api/ws') await resolveAuth(req, reply, c, { allowApiKey: false });
  });
}
