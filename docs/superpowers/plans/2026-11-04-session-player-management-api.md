# Session Player Management API Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox syntax for tracking.

**Goal:** Complete PR #178 with authenticated invitation APIs, OpenAPI, and React Query.
**Architecture:** Shared Zod HTTP contracts wrap the existing transactional invitation use case. Browser transports call HTTP endpoints; the controller owns user/session-scoped React Query reads and mutations.
**Tech Stack:** Next.js, TypeScript, Zod, TanStack React Query v5, Vitest, Storybook.
**Spec:** `docs/superpowers/specs/2026-11-04-session-player-management-design.md`, API correction section.

## Global Constraints

- Preserve sidebar, participant visuals, invitation policy, and saved refund requests.
- Active owner only; sends target OPEN upcoming sessions, with 1–50 unique recipients.
- Bearer or login-cookie reads; bearer-only writes, no-store responses, opaque infrastructure errors.
- No automatic mutation retries; no merge, deployment or live migration.
- Update the existing PR branch using semantic commits.

## Review Focus

- Anonymous or foreign owners must not receive private group/member data.
- Malformed bodies, duplicate IDs, oversized batches, and stale group selections must fail.
- Failed optional reads must preserve the roster and support retry.
- Cache entries must be scoped by account and session; successful sends must refresh history.
- Ambiguous refund failures must preserve the original request and idempotency key.

### Task 1: Invitation HTTP API and OpenAPI

**Files:** new session-invitation HTTP contracts, action/dependency modules, collection route, OpenAPI registration and route tests; existing participant OpenAPI schema.
**Interfaces:** GET returns `{ groups, invitations }`; POST accepts `{ source: 'direct', handles }` or `{ source: 'group', groupId, userIds }` and returns `{ invited, alreadyInvited, alreadyParticipating }`.

- [x] Add route/schema regressions and observe failures for the missing endpoints and totalSlots.
- [x] Implement authentication, validation, safe serialization, use-case dispatch and OpenAPI.
- [x] Run route, use-case and OpenAPI tests.

### Task 2: HTTP transports and React Query controller

**Files:** new browser HTTP transport/query keys; participant controller/page; remove invitation Server Actions; transport, page and browser controller regressions.
**Interfaces:** retain injectable dialog transports and typed outcomes; use `useQuery`/`fetchQuery` for reads and `useMutation` for sends/removal. Invalidate owner/session history after successful writes.

- [x] Add HTTP transport regressions for success, error, invalid responses and refund recovery; observe failures.
- [x] Implement transports and React Query wiring with cancellation and account/session keys.
- [x] Exercise production controller against stubbed HTTP endpoints in Storybook.

### Task 3: Verification and PR update

- [x] Run full unit suite, relevant Storybook checks, typecheck, lint, production build and diff checks.
- [x] Review changes against the request, resolve findings, record evidence.
- [x] Commit and push the existing PR branch; update PR description with API and React Query behavior.

## Verification record

- Baseline: 3,531 unit tests passed before changes.
- Final: 3,569 unit tests passed, with the existing 75 skipped and 1 todo.
- Disposable database: 142 tests passed across 18 files.
- Production Chromium/browser and HTTP suite: 83 tests passed.
- Relevant Storybook interactions/accessibility: 42 checks passed across 4 files.
- Production build, typecheck, ESLint, Swagger validation, migration-number checks and diff checks passed.
- Fresh review findings (POST authentication documentation and optional-loading control coupling) were fixed with RED→GREEN regressions.
- Production browser testing caught the missing route QueryProvider; the route now follows the existing session-page provider pattern, and invitation/removal/recovery E2E checks pass.
- Ruling: preserve bearer-only writes and existing read-only cookie authentication; extending cookie write authority is outside this correction.
- No live database, deployment, merge, sidebar or dependency changes.
