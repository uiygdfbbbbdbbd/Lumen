import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { can, LumenError, type Feature } from '@lumen/shared';
import type { Container } from '../container.js';
import type { AuthContext, AuthRequirement, RateLimitSpec, RouteMeta } from './types.js';
import { enforceCsrf } from './csrf.js';
import { resolveAuth } from './auth-context.js';

/** Every route registered through `route()` is recorded here so security tests can enumerate them. */
export const ROUTE_TABLE: RouteMeta[] = [];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HandlerCtx<B, Q, P, A extends AuthContext | null> {
  req: FastifyRequest;
  reply: FastifyReply;
  body: B;
  query: Q;
  params: P;
  auth: A;
  c: Container;
  ip: string;
}

type AuthFor<R extends AuthRequirement> = R extends 'public' | 'optional' ? AuthContext | null : AuthContext;

export interface RouteSpec<B, Q, P, R extends AuthRequirement> {
  method: Method;
  url: string;
  auth: R;
  feature?: Feature;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  rateLimit?: RateLimitSpec;
  /** CSRF is enforced for all cookie-authenticated mutations unless explicitly disabled (webhooks only). */
  csrf?: boolean;
  apiKey?: boolean;
  /** Allowed while maintenance mode is on (auth + status endpoints). */
  allowInMaintenance?: boolean;
  bodyLimit?: number;
  handler: (ctx: HandlerCtx<B, Q, P, AuthFor<R>>) => Promise<unknown>;
}

function parse<T>(schema: ZodType<T> | undefined, value: unknown, where: string): T {
  if (!schema) return undefined as T;
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new LumenError('VALIDATION_FAILED', `Invalid ${where}`, {
      details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export function requireFeatureAllowed(auth: AuthContext, feature: Feature): void {
  const state = auth.entitlements.features[feature];
  if (state.allowed) return;
  if (state.reason === 'EMAIL_UNVERIFIED') {
    throw new LumenError('EMAIL_VERIFICATION_REQUIRED', 'Verify your email to use this feature.', { details: { feature } });
  }
  if (state.reason === 'SUSPENDED') throw new LumenError('ACCOUNT_SUSPENDED', 'Your account is suspended.');
  throw new LumenError('FEATURE_LOCKED', 'This feature is not available for your account.', { details: { feature, reason: state.reason } });
}

export function checkAuth(req: FastifyRequest, requirement: AuthRequirement): void {
  if (requirement === 'public' || requirement === 'optional') return;
  const auth = req.auth;
  if (!auth) throw new LumenError('UNAUTHENTICATED', 'Sign in to continue.');
  if (auth.user.status === 'banned' || auth.user.status === 'suspended') {
    throw new LumenError('ACCOUNT_SUSPENDED', 'Your account is suspended.');
  }
  if (requirement === 'verified' && !auth.user.emailVerifiedAt && auth.user.role === 'user') {
    throw new LumenError('EMAIL_VERIFICATION_REQUIRED', 'Verify your email to continue.');
  }
  if (typeof requirement === 'object' && !can(auth.user.role, requirement.permission)) {
    throw new LumenError('FORBIDDEN', 'You do not have permission to do that.');
  }
}

export function route<B = undefined, Q = undefined, P = undefined, R extends AuthRequirement = AuthRequirement>(
  app: FastifyInstance,
  c: Container,
  spec: RouteSpec<B, Q, P, R>,
): void {
  const mutating = spec.method !== 'GET';
  const meta: RouteMeta = {
    method: spec.method,
    url: spec.url,
    auth: spec.auth,
    feature: spec.feature,
    csrf: mutating && spec.csrf !== false,
    rateLimit: spec.rateLimit,
    apiKey: spec.apiKey ?? false,
  };
  ROUTE_TABLE.push(meta);

  app.route({
    method: spec.method,
    url: spec.url,
    bodyLimit: spec.bodyLimit,
    config: { allowInMaintenance: spec.allowInMaintenance ?? false, routeMeta: meta },
    handler: async (req, reply) => {
      await resolveAuth(req, reply, c, { allowApiKey: meta.apiKey });
      if (meta.csrf && req.auth?.method !== 'api_key') enforceCsrf(req);
      checkAuth(req, spec.auth);
      if (spec.feature && req.auth) requireFeatureAllowed(req.auth, spec.feature);

      if (spec.rateLimit) {
        const rl = spec.rateLimit;
        const subject = rl.by === 'user' && req.auth ? `u:${req.auth.user.id}` : `ip:${req.ip}`;
        const limit = rl.limit * c.config.RATE_LIMIT_MULTIPLIER;
        const res = await c.rateLimiter.hit(`${rl.name}:${subject}`, limit, rl.windowMs);
        reply.header('x-ratelimit-limit', limit);
        reply.header('x-ratelimit-remaining', res.remaining);
        reply.header('x-ratelimit-reset', Math.ceil(res.resetAt.getTime() / 1000));
        if (!res.allowed) {
          reply.header('retry-after', Math.max(1, Math.ceil((res.resetAt.getTime() - Date.now()) / 1000)));
          throw new LumenError('RATE_LIMITED', 'Too many requests. Please slow down.', { resetAt: res.resetAt.toISOString() });
        }
      }

      const body = parse(spec.body, req.body, 'request body');
      const query = parse(spec.query, req.query, 'query parameters');
      const params = parse(spec.params, req.params, 'path parameters');
      const result = await spec.handler({
        req,
        reply,
        body,
        query,
        params,
        auth: req.auth as AuthFor<R>,
        c,
        ip: req.ip,
      });
      // The handler already responded. A streamed body may still be in flight (reply.sent stays false until it
      // ends), and awaiting a returned `reply` (a thenable) yields undefined once the client disconnects, so
      // "headers out" or "socket gone" also count as answered; sending again would write headers twice.
      if (result === reply || reply.sent || reply.raw.headersSent || reply.raw.destroyed) {
        if (!reply.sent && !reply.raw.writableEnded) {
          await new Promise<void>((resolve) => {
            reply.raw.once('finish', () => resolve());
            reply.raw.once('close', () => resolve());
          });
        }
        return undefined;
      }
      if (result === undefined) return reply.code(204).send();
      return result;
    },
  });
}

export const uuidParams = z.object({ id: z.string().uuid() });
