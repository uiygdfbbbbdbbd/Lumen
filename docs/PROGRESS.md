# Progress

Living tracker for the build plan in the master spec (Part 20). Updated after each module.

## Status by build step

| # | Step | Status |
|---|------|--------|
| 1 | Monorepo scaffold, config, CI skeleton, shared package, tokens, UI kit, DB schema + migrations + seed | Done |
| 2 | Auth, entitlements, email verification, onboarding, profile, sessions, 2FA | Done (passkeys + OAuth pending) |
| 3 | LLM provider layer, admin provider/model management, mock provider, model selector | Done |
| 4 | Chat core: streaming, branching, search, styles, instructions, compare, palette, shortcuts, PWA | Done |
| 5 | Files, RAG pipeline, projects, knowledge bases | Next |
| 6–18 | Remaining steps | Not started |

## Known bugs / gaps
- Passkeys (WebAuthn) and OAuth are not implemented yet (schema tables exist).
- Chat: semantic (embedding) search arrives with step 5 (embeddings); full-text search works now.
- Chat: "share selected messages" and public share links are part of step 17 (sharing).
- PWA: offline sends are queued in localStorage and flushed on reconnect (not the Background Sync API).
- Provider health checks run on demand (admin "Test") and via `healthCheckAll()`; the worker app that schedules
  them is part of step 10.
- Docker is unavailable in the build sandbox: Compose stack, Mailpit, Testcontainers and sandbox tests are unverified here.

## Architecture notes
- Server: Fastify 5, `route()` helper centralizes auth/permission/entitlement/CSRF/rate-limit/validation and
  records every route in `ROUTE_TABLE` (used by the security suite).
- DI container in `apps/server/src/container.ts`; tests override db/clock/mail/storage/rate limiter.
