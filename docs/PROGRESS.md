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
| 6 | Artifacts + sandboxed renderer + versioning + exports | Done |
| 7 | Memory system + consolidation + UI | Done |
| 8 | Built-in tools (web search/fetch, deep research, image gen, canvas, ask-user, charts) | Next |
| 9–18 | Remaining steps | Not started |

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
- Artifacts: LaTeX is previewed via Markdown + KaTeX (no TeX engine); real PDF compilation needs Code Mode
  (step 9). React artifacts can import only react, react-dom, recharts and lucide-react. Gallery thumbnails are
  live renders, not stored screenshots. "Remix" of another user's private artifact isn't possible by design.
- Artifacts: the Caddy CSP for the runtime and the `/a/*` embed headers are unverified here (no Docker); the
  runtime's `<meta>` CSP and sandbox checks are covered by E2E.
- Memory: consolidation runs after N changes or on demand; the nightly run needs the scheduler (step 10). The
  model-guided merge/contradiction pass isn't exercised by tests (the mock model can't return a custom JSON
  plan); its parser ignores anything invalid, and deterministic dedupe + summary are tested.
- Memory: secret detection is pattern-based (keys, tokens, passwords, card/ID/bank numbers); sensitive-category
  avoidance relies on the model following the policy.
- Docker is unavailable in the build sandbox: Compose stack, Mailpit, Testcontainers and sandbox tests are unverified here.

## Architecture notes
- Server: Fastify 5, `route()` helper centralizes auth/permission/entitlement/CSRF/rate-limit/validation and
  records every route in `ROUTE_TABLE` (used by the security suite).
- DI container in `apps/server/src/container.ts`; tests override db/clock/mail/storage/rate limiter.
- Artifacts (web): `apps/web/src/features/artifacts/` — `ArtifactWorkspace` (split view + resizable panel),
  `ArtifactPanel` (versions, editor, exports, sharing), `renderers/*` (one per type), `ArtifactFrame` (sandbox
  bridge). The runtime itself lives in `apps/web/runtime/` and is built to `public/runtime/` by `build:runtime`.
- Memory: `apps/server/src/services/memory/` (service), `services/tools/memory-tools.ts` (tools + policy),
  `apps/web/src/features/memory/` (settings page, "Memory used" chip, tool rows).
- Artifact format helpers (types, chart spec, slides, CSV, spreadsheet formulas) live in `@lumen/shared` and are
  used by both the server (exports) and the web renderers.

## Test status (last full run)
- Server 272 (unit + integration + security), shared 142, llm 66, ui 16, web 48 (coverage gate ≥80% lines).
- E2E (Playwright + axe): 41 passed, including artifacts (sandbox isolation, bridge storage, Monaco editing,
  diff/restore, "Fix with AI", charts, spreadsheet, gallery, publish/embed/unpublish) and memory (AI writes,
  "Memory used", settings edit/pin/undo, import review, tidy-up summary, pause, forget everything, per-chat opt-out).
