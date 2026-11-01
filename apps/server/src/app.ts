import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { LumenError, REQUEST_ID_HEADER, type ApiErrorBody } from '@lumen/shared';
import type { Container } from './container.js';
import { ensureCsrfCookie } from './http/csrf.js';
import { registerRoutes } from './routes/index.js';
import { scrubSecrets } from './lib/logger.js';

export async function buildApp(
  c: Container,
  extraRoutes?: (app: FastifyInstance, c: Container) => void,
): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: c.log as FastifyBaseLogger,
    trustProxy: c.config.TRUST_PROXY,
    bodyLimit: c.config.MAX_JSON_BODY_BYTES,
    genReqId: (req) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
    disableRequestLogging: c.config.isTest,
  });

  app.decorateRequest('auth', null);
  app.decorateRequest('authResolved', false);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: c.config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cookie, { secret: c.config.SESSION_SECRET });
  await app.register(cors, {
    origin: [c.config.PUBLIC_URL, ...c.config.CORS_ORIGINS],
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', 'x-request-id', 'idempotency-key'],
    exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'],
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10 } });

  app.addHook('onRequest', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
    ensureCsrfCookie(req, reply, { secure: c.config.cookieSecure, domain: c.config.COOKIE_DOMAIN });
  });

  // Maintenance mode: block everything except routes that opt in (auth, status, admin settings).
  app.addHook('preHandler', async (req) => {
    const routeConfig = req.routeOptions.config as { allowInMaintenance?: boolean } | undefined;
    if (routeConfig?.allowInMaintenance) return;
    const m = await c.settings.get('maintenance');
    if (!m.enabled) return;
    if (m.readOnly && (req.method === 'GET' || req.method === 'HEAD')) return;
    throw new LumenError('MAINTENANCE', m.message || 'We are performing maintenance. Please check back soon.');
  });

  app.setErrorHandler((err, req, reply) => {
    let e: LumenError;
    if (err instanceof LumenError) e = err;
    else if (err instanceof ZodError) e = new LumenError('VALIDATION_FAILED', 'Invalid request', { details: err.issues });
    else if ((err as { statusCode?: number }).statusCode === 413 || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      e = new LumenError('PAYLOAD_TOO_LARGE', 'Request is too large.');
    } else if ((err as { statusCode?: number }).statusCode === 415) {
      e = new LumenError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.');
    } else if ((err as { statusCode?: number }).statusCode === 400 || (err as { validation?: unknown }).validation) {
      e = new LumenError('BAD_REQUEST', 'Malformed request.');
    } else {
      req.log.error({ err: { message: scrubSecrets(String((err as Error).message)), stack: (err as Error).stack } }, 'unhandled error');
      e = new LumenError('INTERNAL', 'Something went wrong on our side.');
    }
    if (e.status >= 500 && e.code !== 'INTERNAL') req.log.warn({ code: e.code }, e.message);
    const body: ApiErrorBody = e.toBody(req.id);
    return reply.code(e.status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(new LumenError('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}`).toBody(req.id));
  });

  await registerRoutes(app, c);
  extraRoutes?.(app, c);
  return app;
}
