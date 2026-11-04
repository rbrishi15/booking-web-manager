# Session player management acceptance

Implementation date: 4 November 2026 (Asia/Singapore).

Transferred and refined the final diff from
[liang799/booking-web-manager PR #13](https://github.com/liang799/booking-web-manager/pull/13)
at `1c0fab4c3f979d395ee928cff1084f792fe0ab9b`, based on Rishi's
`98ba30633d71a6f76d66aec7aad90d2cea83de63`. The original fork and shared branch
histories were preserved. The new branch has focused semantic commits instead
of replaying the source's 50 commits.

## Behavior and architecture

- An active booker invites exact public user IDs, shares the existing session
  invitation link, or selects members of an active group.
- Group import sends invitations. Recipients review the session and confirm
  their own booking share through the existing commitment flow.
- `ManageSessionInvitations` owns booker authorization, lifecycle, normalized
  IDs, eligibility, duplicate outcomes, and canonical notification decisions.
- One serializable Postgres transaction checks current membership, persists
  invitations and notifications, and retries serialization failures. Unique
  session/recipient pairs prevent duplicate invitations and deliveries.
- Joining marks pending invitations accepted atomically. Pending invitations
  neither reserve capacity nor move funds.
- Optional invitation/group read failures leave participant management usable
  and show retry feedback with an unknown invitation count.
- Displayed capacity comes from authoritative `totalSlots`, including reserved
  replacement places. Removal refunds, recovery, history, and attendance remain
  available through their existing workflows.

## Initial implementation verification

| Check | Result |
| --- | --- |
| Main baseline | 3,514 unit tests passed; typecheck passed |
| Final unit suite | 3,531 passed; baseline 75 skipped and 1 todo retained |
| Disposable Supabase integration | 142 passed across 18 files |
| Relevant Storybook interactions/accessibility | 38 passed across 3 files |
| Chromium browser regressions | 10 passed |
| Production Next.js/Storybook build | Passed |
| Typecheck, ESLint, diff whitespace | Passed |
| Migration number uniqueness | Passed |
| Sidebar, shared shell, global styles diff | Empty |

Database checks exercise concurrent/repeated sends, atomic rollback when
notification persistence fails, stale/arbitrary group member selection,
acceptance tracking, and push relevance. Browser checks cover actual rendering,
both reference layouts, exact-ID queues and duplicates, clipboard denial,
selected group members, light hover contrast, and 390/768/1280px layouts.

New regressions were observed failing before fixes for capacity reservations,
recoverable invitation reads, pending lookups, keyboard tabs, closing/reopening
during a send, unavailable history, dialog focus restoration, cancellation
labels, and narrow-screen overflow. Real pointer hover is tested with
Playwright; synthetic Storybook hover does not activate CSS `:hover`.

## Invitation HTTP API and React Query follow-up

The follow-up replaces invitation Server Actions with documented HTTP APIs:

| Method | Endpoint | Authentication | Behavior |
| --- | --- | --- | --- |
| GET | `/api/sessions/{sessionId}/invitations` | Bearer or login cookie | Owner-only groups, eligible members and invitation history |
| POST | `/api/sessions/{sessionId}/invitations` | Bearer | Direct exact-handle or selected group-member invitation batch |

POST accepts `{ source: "direct", handles: [...] }` or
`{ source: "group", groupId, userIds: [...] }`. Both responses are `no-store`.
The shared Zod contracts document request/response shapes and failures in OpenAPI.
Participant response documentation now includes authoritative `totalSlots`.

The participant controller uses React Query queries for roster and invitation
options, `fetchQuery` for exact-player lookup, invitation links and refund
previews, and mutations for invitation sends and removals. Queries are scoped
by account and session. Reads accept cancellation; writes have no automatic
retries. Successful sends refresh invitation history. Optional invitation
loading/errors preserve existing participant controls; saved removal retries
retain the original target, preview version and idempotency key.

The participant route provides its own account-keyed React Query provider,
matching the existing sessions-page pattern. Production browser testing verifies
this assembly as well as the injected controller stories.

| Follow-up check | Result |
| --- | --- |
| Full unit suite | 3,575 passed; existing 75 skipped and 1 todo retained |
| Disposable Supabase database suite | 143 passed across 18 files |
| Production Chromium/browser and HTTP suite | 83 passed |
| Relevant Storybook interactions/accessibility | 42 passed across 4 files |
| Production Next.js/Storybook build | Passed |
| Typecheck, ESLint, Swagger validation, migration numbers, diff whitespace | Passed |

Real HTTP/browser checks cover both invitation sources, normalized duplicate
IDs, owner rejection, current group membership, no enrollment or money movement,
cookie reads, bearer-only writes, UI sends and history refresh. Existing removal
browser checks verify full refunds, changed previews and durable replay after
losing a committed response.

The original invitation Server Actions and their obsolete tests were removed.
API authentication inventory coverage includes both new operations. New browser
checks exercise the real production controller rather than only the visual view.

Fresh review found and fixed two issues: POST documentation incorrectly claimed
cookie write support, and optional loading disabled participant controls. Each
correction was verified with a failing regression followed by a passing run.
The missing-configuration API path was also corrected to return the documented
503 response while unexpected assembly failures remain opaque 500 responses.


## CI and CodeRabbit follow-up

- The keyboard removal test now holds the first roster HTTP request, verifies
  that controls are disabled while it is pending, and waits for the control to
  become enabled and focused before pressing Enter. This covers the CI race
  without increasing timeouts or adding retries.
- Invitation sends recheck the upcoming-session cutoff after recipient lookup
  and after the final awaited notification write inside the transaction. Late
  sends fail with `SESSION_STARTED`; a disposable database regression confirms
  that both invitation and inbox rows roll back and no publication occurs.
- Migration 0023 documents manual reversal order, invitation data loss, app
  rollback sequencing and later-migration dependencies. No executable migration
  statements or live databases were changed by this follow-up.
- The pool comment referred to the removed Server Action factory. The current
  HTTP loader already shares a module-scoped initialization promise. Regression
  checks use the actual composition root to verify one pool provider for
  concurrent/warm callers, lazy opening, and recovery after setup failure.
- Fresh local verification: 3,575 unit tests, 143 disposable database tests and
  83 production browser/HTTP tests passed; build, typecheck, lint, migration
  numbering and diff checks passed. Existing 75 unit skips and 1 todo remain.

## Visual evidence

The content was compared at the supplied reference dimensions. Light uses
Inter semibold participant names, a warm court scene, pale avatars, and a dark
occupancy bar. Dark has its own measured header, card, tabs, and row layout.
Rishi's existing sidebar is retained in every capture.

- [Light, 1798 × 875](../assets/session-player-management-light.png): summary
  x=332, y≈323, width=1422, height=147.
- [Dark, 1714 × 918](../assets/session-player-management-dark.png): summary
  x=315, y≈265, width=1347, height≈146.
- [Invite players](../assets/session-player-management-invite.png).
- [Import from group](../assets/session-player-management-group.png).
- [Mobile group import](../assets/session-player-management-group-mobile.png).

Reference-sized screenshots were checked visually and with geometry/color
assertions. Decorative artwork was reconstructed from the supplied screenshots;
the original unobscured photo assets were unavailable. Fixture IDs obey the
existing 5–32 character public-ID policy, and the booker is excluded from
importable recipients. The group confirmation says “Invite N members” to match
the actual invitation behavior.

Generated assets and built-in imagegen prompts are documented in
[participants-light.md](../../public/images/sessions/participants-light.md) and
[group-thumbnails.md](../../public/images/sessions/group-thumbnails.md).

## Independent review

A fresh reviewer inspected authorization, transaction consistency, architecture,
browser behavior, and the whole branch. No critical backend issues were found.
All four actionable findings were addressed: focus restoration after Escape,
Cancel and success; readable light hover states; supported-width overflow; and
correct cancellation/left-waitlist history labels. The mobile entry animation
was also corrected to keep the sheet inside the viewport.

Visual comparison was performed by the implementer. Live push delivery and
deployment were outside this task. Normal repeated discrete submissions are
guarded by disabled UI state and database uniqueness; raw same-tick
programmatic invocation was not independently established as a user-facing
defect. No review findings were deferred.

## Deployment

Apply `0023_session_invitations.sql` before deploying this application revision.
Only a disposable local database was migrated during verification. This task
does not merge the PR, change a live database, or deploy the application.
