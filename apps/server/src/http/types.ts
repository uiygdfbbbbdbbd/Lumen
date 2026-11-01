import type { Entitlements, Feature, Permission } from '@lumen/shared';
import type { UserRow } from '../db/schema/index.js';

export interface AuthContext {
  user: UserRow;
  /** Present for cookie sessions. */
  sessionId: string | null;
  /** Present for API-key auth (developer platform). */
  apiKeyId: string | null;
  scopes: string[] | null;
  method: 'session' | 'api_key';
  entitlements: Entitlements;
}

export type AuthRequirement =
  | 'public'
  | 'optional'
  | 'user'
  | 'verified'
  | { permission: Permission };

export interface RateLimitSpec {
  /** Bucket name, e.g. "auth:login". */
  name: string;
  limit: number;
  windowMs: number;
  /** What to key on. "user" falls back to IP for anonymous requests. */
  by?: 'ip' | 'user';
}

export interface RouteMeta {
  method: string;
  url: string;
  auth: AuthRequirement;
  feature?: Feature;
  csrf: boolean;
  rateLimit?: RateLimitSpec;
  /** Whether the route accepts API-key (Bearer) auth in addition to sessions. */
  apiKey: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    authResolved: boolean;
  }
}
