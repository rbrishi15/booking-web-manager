# Edit Session Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Steps use checkbox syntax for tracking.

**Goal:** Make the existing Edit session button open a working persistent editor.

**Architecture:** Session owns editing invariants and returns a validated candidate.
EditSession owns owner authorization, current-state projection and stale-version
checks in a serializable transaction. Authenticated HTTP and an injected browser
transport connect a Radix dialog to this use case.

**Tech Stack:** TypeScript, Next.js, React, Radix, Zod, PostgreSQL, Vitest/Storybook.

**Spec:** docs/superpowers/specs/2026-11-04-edit-session-design.md

## Global Constraints

- Only the active session owner can edit an OPEN session strictly before start.
- Lock booking terms after participation history exists; capacity includes booker and reservations.
- Preserve participant history, held payments and the sidebar.
- Use Singapore time, existing pricing rules and semantic commits.

## Review Focus

- A player joins while an editor is open: stale save is rejected with reload.
- Two editors change the same session: version check prevents lost updates.
- A full session keeps its visibility while capacity changes: saving works.
- A failed or uncertain save: keep input and allow reload of authoritative state.
- A date crossing UTC midnight: Singapore values round-trip without shifting.

### Task 1: Authorized editing policy

**Files:** domain/sessions/session/session.ts, domain/accounts/booker.ts,
use-cases/sessions/EditSession.ts, use-cases/sessions/session-editing-transaction.ts,
tests/use-cases/edit-session.test.ts.

**Interfaces:** EditSession.detailsForBooker(bookerId, sessionId) returns current
editable fields, permissions, minimum capacity and version. EditSession.forBooker
accepts those fields plus version and returns saved details. Session.editDetails
returns a validated Session candidate without mutating the original.

- [ ] Write policy tests for successful terms/capacity changes, authorization,
  lifecycle, locks, reserved capacity, price bounds and stale versions.
- [ ] Run the tests and confirm missing behavior fails.
- [ ] Implement the domain candidate and application workflow; run policy tests.
- [ ] Commit `feat(sessions): add authorized session editing policy`.

### Task 2: Persistent HTTP editing

**Files:** lib/sessions/postgres-session-management-repository.ts,
lib/sessions/postgres-session-editing-transaction.ts, use-case-config/session-editing.ts,
app/sessions/editing-*.ts, app/api/sessions/[sessionId]/edit/route.ts,
tests/app/sessions/session-editing-route.test.ts,
tests/integration/session-management-persistence.test.ts.

**Interfaces:** GET and PATCH /api/sessions/{sessionId}/edit return validated
SessionEditingDetails. PATCH accepts SessionEditRequest. Identity comes from auth.

- [ ] Write failing route and persistence tests for authenticated reads/writes,
  malformed payloads, safe errors and saving only editable session columns.
- [ ] Implement the transaction, SQL write, server composition and route schemas.
- [ ] Run route/policy/persistence checks; register the route in OpenAPI.
- [ ] Commit `feat(sessions): persist session edits through authenticated API`.

### Task 3: Dialog and complete verification

**Files:** app/sessions/_components/session-edit-dialog.tsx,
app/sessions/_components/session-edit-dialog.module.css,
app/sessions/_components/session-edit-dialog.stories.tsx,
app/sessions/_components/session-participants-view.tsx,
app/sessions/editing-transport.ts, tests/app/sessions/session-editing-transport.test.ts.

**Interfaces:** SessionEditDialog consumes injected load/save transport and calls
onSaved after commit. Participant view refreshes its current data on save.

- [ ] Write failing browser stories for loading, locked fields, save, cancel,
  errors, stale reload, focus and disabled lifecycle controls.
- [ ] Implement the prefilled Singapore-time form, validation and pending/error UI.
- [ ] Run the focused browser stories; inspect desktop and mobile rendering.
- [ ] Run unit tests, typecheck, lint, build and diff checks; review final diff.
- [ ] Commit `feat(sessions): connect edit session dialog`.
