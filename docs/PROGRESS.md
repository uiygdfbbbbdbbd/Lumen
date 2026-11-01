# Progress

Living tracker for the build plan in the master spec (Part 20). Updated after each module.

## Status by build step

| # | Step | Status |
|---|------|--------|
| 1 | Monorepo scaffold, config, CI skeleton, shared package, tokens, UI kit, DB schema + migrations + seed | Done |
| 2 | Auth, entitlements, email verification, onboarding, profile, sessions, 2FA | Done (passkeys + OAuth pending) |
| 3 | LLM provider layer, admin provider/model management, mock provider, model selector | Done |
| 4 | Chat core: streaming, branching, search, styles, instructions, compare, palette, shortcuts, PWA | Done |
| 5 | Files, RAG pipeline, projects, knowledge bases | Done |
| 6 | Artifacts + sandboxed renderer + versioning + exports | Next |
| 7–18 | Remaining steps | Not started |

## Known bugs / gaps
- Passkeys (WebAuthn) and OAuth are not implemented yet (schema tables exist).
- Chat history search is full-text only; semantic search covers files/knowledge (step 5), not chats yet.
- Files: OCR (Tesseract) for scanned PDFs/images and audio/video transcription are not implemented yet;
  such files are stored and downloadable but contribute no text. Reranking is not implemented (RRF only).
- Files: vectors are stored in a dimension-less pgvector column and searched exactly within the user's
  scope (no ANN index). Fine for per-user corpora; very large shared knowledge bases would need an index.
- Project collaboration (invites, member management UI, comments) is step 17; access checks for
  viewer/editor/owner are already enforced server-side.
- Chat: "share selected messages" and public share links are part of step 17 (sharing).
- PWA: offline sends are queued in localStorage and flushed on reconnect (not the Background Sync API).
- Provider health checks run on demand (admin "Test") and via `healthCheckAll()`; the worker app that schedules
  them is part of step 10.
- Docker is unavailable in the build sandbox: Compose stack, Mailpit, Testcontainers and sandbox tests are unverified here.

## Architecture notes
- Server: Fastify 5, `route()` helper centralizes auth/permission/entitlement/CSRF/rate-limit/validation and
  records every route in `ROUTE_TABLE` (used by the security suite).
- DI container in `apps/server/src/container.ts`; tests override db/clock/mail/storage/rate limiter.
