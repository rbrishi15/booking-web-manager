# Session Player Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Transfer and refine fork PR #13 into Rishi's repo with matching screens and a clean semantic history.

**Architecture:** Reuse the final fork diff. Keep invitation policy in `ManageSessionInvitations`, transactional persistence in its Postgres adapter, and browser-safe injected transports in the UI. Supply authoritative participant capacity and isolate optional invitation reads from the participant page.

**Tech Stack:** Next.js, React, TypeScript, CSS modules, Postgres/Supabase, Vitest, Storybook, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-session-player-management-design.md`

## Global Constraints

- Preserve the current sidebar exactly.
- Import creates invitations; recipients authorize their own joining and payment.
- Active booker only, OPEN upcoming sessions only, 1–50 unique recipients per send.
- Invitation and notification writes share one serializable transaction.
- No live database migration, merge, or deployment.
- Rebuild history on `tianpok/session-player-management`; leave source/shared history intact.
- Semantic commits; retain source attribution.

## Review Focus

- Reserved replacement seats must not reduce displayed total capacity (Task 2).
- A failed group/invitation read must not destroy the participant page (Task 1).
- Rapid repeated lookup/send or closing a dialog during a request must not corrupt its queue (Task 2).
- Repeated/concurrent sends must not duplicate invitations or notifications (Task 1).
- Dialog keyboard navigation, focus, mobile overflow, and both themes must work (Task 3).

### Task 1: Transactional invitations and owner-authorized read

**Files:** `use-cases/sessions/ManageSessionInvitations.ts`, `lib/sessions/postgres-session-invitation-transaction.ts`, `use-case-config/session-invitations.ts`, `app/sessions/session-invitation-actions.ts`, `supabase/migrations/0023_session_invitations.sql`, notification intent/presentation files, participant page, and corresponding use-case/action/persistence tests.

**Interfaces:** Keep fork `inviteByHandles(hostId, sessionId, handles)`, `inviteFromGroup(hostId, sessionId, groupId, userIds)`, `listForBooker(hostId, sessionId)` and `SessionInviteSummary`. Provide typed load outcomes for optional group/invitation data rather than throwing or returning fake empty results.

- [x] Establish baseline unit/type checks in the isolated main-based worktree.
- [x] Port the fork's final diff, using its use-case tests as the inherited behavior contract; verify the new tests fail without implementation where practicable.
- [x] Add tests for optional loading failures, notification failures, duplicate persistence/acceptance and stale group membership; verify meaningful failures before fixes.
- [x] Refine the policy/read seam and adapter without adding payment/participation side effects.
- [x] Run targeted unit and disposable-database tests; expect authorization rejection, atomic rollback, and one notification per recipient.
- [x] Commit coherent backend changes with `feat(sessions): add booker session invitations` and source attribution.

### Task 2: Reference-matched participant page and dialogs

**Files:** `session-participants-view.tsx`, `session-participants-invitations.tsx`, `session-participants-controller.tsx`, `session-participants.module.css`, `ListSessionParticipants.ts`, participant result serialization/fixtures/tests, and local invitation contracts/read adapters as needed.

**Interfaces:** Keep injected `SessionInvitationsTransport`; add authoritative `totalSlots` to participant results. Invitation dialogs report `SendSessionInvitationsResult` through `onInvited`.

- [x] Add a capacity regression asserting a reserved place leaves `totalSlots` unchanged, then implement/serialize it.
- [x] Match reference type/spacing/colors/background/rows/dialogs with real fixtures; reuse existing matching image assets and inspect remaining asset differences.
- [x] Give optional loads retry feedback, connect direct-invite success to the same notice as group invites, and correct participant/history labels.
- [x] Exercise queue normalization/duplicates, pending state, refreshes, and clipboard fallback through interaction tests before fixing regressions.
- [x] Use accessible tab/selection primitives or equivalent complete keyboard behavior; preserve removal and attendance flows.
- [x] Run targeted unit/Storybook checks and commit `feat(sessions): replicate player management design`.

### Task 3: Browser evidence, review, and PR

**Files:** participant/invitation stories, `tests/e2e/storybook-session-participants.spec.ts`, existing removal tests and Playwright configuration, screenshot evidence, acceptance notes.

**Interfaces:** Browser-safe story transports; existing routes remain unchanged.

- [x] Add representative reference fixtures and browser interaction checks for invitation send/link/import, tabs, errors, keyboard use, both themes, and mobile overflow.
- [x] Capture and inspect participant light/dark, direct invitation, and group import screenshots against the supplied images; refine concrete mismatches.
- [x] Run unit, typecheck, lint, production build, relevant Storybook and browser checks; report baseline failures separately.
- [x] Verify sidebar/shared shell files have no diff, migration numbering is unique, and semantic commit sequence is clean.
- [x] Obtain whole-branch review, fix actionable findings, and rerun affected checks.
- [ ] Commit acceptance evidence, push to Rishi's repo, create and attach a PR with migration and verification details. Do not merge.
