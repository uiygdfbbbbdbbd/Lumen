# Progress

Living tracker for the build plan in the master spec (Part 20). Updated after each module.

## Status by build step

| # | Step | Status |
|---|------|--------|
| 1 | Monorepo scaffold, config, CI skeleton, shared package, tokens, UI kit, DB schema + migrations + seed | In progress |
| 2 | Auth, entitlements, email verification, onboarding, profile, sessions, 2FA | Server done; web UI in progress |
| 3–18 | Remaining steps | Not started |

## Known bugs / gaps
- Passkeys (WebAuthn) and OAuth are not implemented yet (schema tables exist).
- Docker is unavailable in the build sandbox: Compose stack, Mailpit, Testcontainers and sandbox tests are unverified here.

## Architecture notes
- Server: Fastify 5, `route()` helper centralizes auth/permission/entitlement/CSRF/rate-limit/validation and
  records every route in `ROUTE_TABLE` (used by the security suite).
- DI container in `apps/server/src/container.ts`; tests override db/clock/mail/storage/rate limiter.
