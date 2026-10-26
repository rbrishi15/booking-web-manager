# Groups Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the final card-based responsive Groups reference and create a PR from current `origin/main`.

**Architecture:** The server page authenticates and loads existing groups and a bounded batch of display names. A client view receives display-only summaries and the existing creation form as a React node, and renders an accessible creation dialog plus image cards.

**Tech Stack:** Next.js, React, CSS modules, Radix, Vitest, Storybook/Chromium.

**Spec:** `docs/superpowers/specs/2026-10-26-groups-page-design.md`

## Global Constraints

- Preserve shared sidebar, group actions, detail page, authentication, and leave confirmation.
- No schema, API, domain, dependency, or fabricated metadata changes.
- Keep invitation tokens and member IDs out of client props.
- Final card reference supersedes all earlier toolbar/banner/list requirements.

## Review Focus

- Empty membership results offer creation; one-member groups use singular copy.
- Every card remains a link, including archived groups with accurate role labels.
- Member previews use real names with safe unnamed/deleted-user display.
- Long names wrap without horizontal overflow at 390px.
- Dialog supports labelled input, Escape, and focus return.

### Task 1: Responsive image cards

**Files:** `app/groups/_components/groups-view.tsx`, `groups-view.module.css`, `groups-view.stories.tsx`, `public/images/groups/`.

**Interfaces:** `GroupSummary` contains groupId, name, memberCount, memberNames (up to four), joinedAt ISO string, isOwner, archived, invitationActive. `GroupsView` consumes summaries, a createForm React node, and a left boolean.

- [x] Write browser stories for card links, roles, archived state, empty/one-member groups, and dialog keyboard behavior.
- [x] Implement the responsive two-column cards, cover imagery, real metadata, theme-specific styling, and dialog.
- [x] Run stories and inspect screenshots at desktop/mobile, light/dark, and with long names.

### Task 2: Server integration and PR

**Files:** `app/groups/page.tsx`, `tests/app/groups/groups-page.test.ts`, `app/groups/README.md`.

**Interfaces:** Existing `listMine({ actorId })`, `displayNames(userIds)`, and `CreateGroupForm` feed `GroupsView` without exposing domain objects or invitation secrets.

- [x] Write server tests for authentication, display-only props, name batching, empty data, viewer join date/role, and leave status; observe red.
- [x] Implement server mapping; confirm five tests pass.
- [x] Document the new page and data limits.
- [x] Run unit tests, browser stories, typecheck, lint, production build, and final branch review.
- [ ] Commit semantically, push feature branch, create PR against main, and attach it to the chat.
