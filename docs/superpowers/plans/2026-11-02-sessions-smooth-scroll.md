# Sessions Smooth Scroll Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this single task.

**Goal:** Make the dot follow native scrolling and open the nearby card after a pause, while keeping smooth explicit navigation.

**Architecture:** Remove wheel ownership from useTimelineNavigation. Observe native scroll progress, update the marker each frame, and debounce card expansion for 200 ms. Reuse the 280 ms animation with date anchoring for scroll-driven expansion. Ignore internal scroll corrections and clear pending work on interruption. Limit keyboard selection to date controls.

**Tech Stack:** React, TypeScript, Storybook, Playwright.

**Spec:** ../specs/2026-11-02-sessions-smooth-scroll-design.md

## Global Constraints

- No new dependencies, global scrolling changes or data changes.
- Preserve reduced motion, mobile, dialogs, pagination and URL restoration.

## Review Focus

- Tiny trackpad deltas and momentum must pass through; the marker must move before card expansion.
- Further input must restart the pause and cancel stale animations; own scroll writes must not restart selection.
- Page keys outside date controls must retain browser behavior.
- Date/row selection must still animate and retain accessible focus.
- Pagination and viewport changes must retain existing anchors.

### Task 1: Restore native scrolling

**Files:** use-timeline-navigation.ts, sessions-view.tsx, sessions-view.stories.tsx, tests/e2e/sessions-timeline.spec.ts; remove timeline-gesture.ts and its unit tests.

**Interfaces:** Preserve the navigation hook's existing arguments and return values.

- [x] Add browser regressions for unconsumed input, continuous marker progress with delayed expansion, native keyboard scrolling, and interruption; run them against the original behavior and observe failure.
- [x] Remove wheel classification/queueing. Follow native scrolling with a per-frame marker and 200 ms quiet timer, preserving the chosen date's viewport anchor during expansion. Keep immediate explicit selection, reduced motion and date-only keyboard navigation.
- [x] Replace obsolete gesture expectations with native scrolling and explicit-click coverage; retain restoration, interruption, focus, responsive and pagination tests.
- [x] Run focused Storybook tests and Chromium/WebKit timeline tests, unit tests, lint, typecheck and build. Compare any unrelated failures against origin/main.
- [x] Review the complete diff and prepare the semantic commit and PR targeting main.

## Verification and review

- 54/54 Chromium and WebKit timeline browser checks passed.
- All 36 overview stories passed. The broader overview/controller run passed 54/56; Joined Session Details Dialog and In Progress Hosted Management fail identically with the original main navigation code.
- 3,473 unit tests passed; build, typecheck, lint and diff whitespace checks passed.
- Native input, marker progress before the 200 ms pause, stable marker after pausing, scroll-away-and-back, final-date reachability and pending-opening cancellation have browser coverage.
- Independent review found one stale internal-scroll suppression issue. Its return-scroll regression failed before the fix and passed on both engines after expected notifications were consumed and expired. No other actionable findings were reported.
