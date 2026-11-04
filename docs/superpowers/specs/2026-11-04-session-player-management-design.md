# Session player management transfer

## Intent and approved approach

Move the final work from `liang799/booking-web-manager` PR #13 into
`rbrishi15/booking-web-manager`. The user selected **reuse and refine the fork**.
Match the four supplied screenshots for the participant-management page and
invitation dialogs, in both light and dark themes. Preserve Rishi's current
sidebar exactly. Reconstruct a clean semantic commit history on a fresh branch;
do not rewrite either repository's shared history or the original fork branch.

Source PR: https://github.com/liang799/booking-web-manager/pull/13
Source head inspected: `1c0fab4c3f979d395ee928cff1084f792fe0ab9b`.
Destination base inspected: `98ba30633d71a6f76d66aec7aad90d2cea83de63`.
The source PR's merge base is this destination base. Its final diff has 19
changed files; replaying its 50 commits is unnecessary.

## Approaches

1. **Reuse and refine (selected).** Apply the final source diff to the current
   destination main, repair discovered defects, then organize the result into
   focused semantic commits. Retains working invitation, removal, and attendance
   behavior while allowing targeted architectural improvements.
2. **Rebuild.** Implement the screens and invitation flow again against the same
   application architecture. Offers less inherited code, but duplicates working
   behavior and increases the chance of regressions. The user did not select it.

## Scope and visual contract

- The session participant page has a photographic header, editorial serif
  heading, open/status badge, date/time/venue/occupancy summary, and Participants,
  Waitlist, Withdrawn, and Invitations tabs.
- Actions open an Invite players dialog with user-ID and invite-link tabs, and
  an Import from group dialog with group cards and member checkboxes.
- Match reference spacing, type scale, line treatments, surfaces, colors,
  imagery, button sizing, and modal dimensions at the reference desktop sizes.
  Retain a usable responsive mobile layout and accessible interactions.
- Keep all existing sidebar code, layout, navigation behavior, icons, sizing,
  and styling unchanged. Compare the content area relative to the retained
  sidebar; the screenshots' sidebar is explicitly excluded from replication.
- Retain refund-safe participant removal, its recovery/idempotency behavior,
  participant history, and attendance verification.
- Preserve real session data. No hard-coded names, dates, counts, membership,
  or fake successful actions to mimic a screenshot.
- Existing unsupported session editing stays visibly unavailable; the redesign
  does not introduce an editing use case.

## Business behavior

The booker can select exact public user IDs, share an existing invitation link,
or select members of an active group to invite to the session. Group import
creates invitations. Each recipient still chooses whether to join through the
existing UC2-04 commitment flow, which applies eligibility, capacity/waitlist,
and their own wallet hold. No invitation reserves a place or charges a wallet.
The screenshot's final group action may say "Invite N members" to describe this
actual behavior; this is the intentional copy exception to the visual replica.

Only an active booker may send or inspect session invitations. Sending is
permitted only while the session is OPEN and strictly before its start time.
Recipient lookup uses normalized exact user IDs. Batch selection is bounded to
50 recipients, with duplicates rejected or reported consistently. Existing
participants and the booker are skipped; resending an existing invitation
does not create a second notification. Group selection is revalidated against
the booker's current membership and active group/account state when sent.

Notifications link to the existing token-checked session preview. These are
shareable session room links, not recipient-specific access tokens. Joining
continues to require authentication and the existing admission rules. A pending
invitation becomes accepted atomically with committed or waitlisted participation.
There is no new decline/revoke workflow in this scope.

## Deep module and seams

Keep `ManageSessionInvitations` as the deep module that owns authorization,
session lifecycle, normalization, recipient eligibility, duplicate outcomes,
and notification decisions behind a small send/list interface. Keep policy out
of React and SQL adapters. Use the existing transaction seam so production
Postgres and meaningful in-memory tests exercise the same interface.

The Postgres adapter runs authorization reads, recipient/group checks, invitation
writes, and canonical notification writes in one serializable transaction with
bounded retries. Publish realtime/push hints only after commit, through the
existing notification publisher. A notification write failure rolls back the
invitation. Unique `(session_id, invitee_id)` storage provides retry safety.

Server actions derive identity from the authenticated session and validate
untrusted input. The composition root supplies the clock, transaction, and
publisher. Browser-facing types/transports stay free of server runtime imports;
Storybook uses injected browser-safe adapters.

Invitation/group loading belongs behind an owner-authorized application read
interface rather than orchestration duplicated in page code. A failed optional
invitation/group load must be represented with actionable retry feedback and
must not hide the participant list or silently masquerade as an empty list.

Participant display uses authoritative total capacity from the session, not
`committed + availableSlots`: named replacement reservations reduce availability
without reducing capacity. Keep participant tab counts, history grouping, and
optimistic removal results consistent with the domain model.

Keep presentation state local unless a cohesive tested model materially reduces
caller complexity. Avoid adding pass-through modules or speculative abstractions.
Concrete refactor details are left to the builder after testing the inherited
behavior.

## Persistence and compatibility

Use the next available migration number on the destination base (currently
`0023`). The migration adds invitation storage, least-privilege access, acceptance
tracking, and dispatch relevance for pending invitations in upcoming open sessions.
Review compatibility with the existing notification relevance function and its
grants. Do not modify an already-applied destination migration.

Apply the new migration before deploying the application. This task prepares a
branch and reviewable PR; it does not merge or deploy changes or mutate a live
database. If main advances, recheck migration numbering and integration before
publishing the PR.

## Verification and acceptance

- Establish current-main baseline for relevant checks before attributing failures.
- Verify use-case authorization, invalid IDs, duplicates, inactive users/groups,
  stale group membership, session start/cancellation, transaction rollback, and
  retry/idempotency behavior through meaningful tests.
- Verify persistence and acceptance tracking on a disposable database when the
  local integration setup is available. Report anything that cannot be run.
- Exercise direct invite, invite-link clipboard fallback, group selection/send,
  participant tabs, removal/refund recovery, and attendance behavior in the
  existing Storybook/browser setup.
- Check keyboard tab navigation, dialog focus/close behavior, pending/error
  states, and narrow-screen overflow.
- Render desktop light/dark participant views and both dialogs with representative
  fixtures. Inspect screenshots against the supplied references, including
  actual image assets. Do not claim pixel identity without comparison evidence.
- Run typecheck, lint, build, relevant unit/Storybook/browser tests, and diff
  hygiene checks. Confirm sidebar files have no diff.
- Use focused semantic commits, e.g. `feat(sessions): add booker invitations`,
  `feat(sessions): replicate player management design`, and
  `test(sessions): verify invitation and participant flows`. Preserve useful
  attribution to the source work when rebuilding its history.
- Push the clean branch to Rishi's repository and open a reviewable PR with
  verification evidence and migration requirements. Leave the fork PR intact.

## Builder decisions and open questions

The user selected the reuse approach. The builder chooses targeted refactor
details, tests, commit boundaries, and the best available existing image assets.
Import-as-invitations follows both the user's invitation wording and the
existing payment model; no silent enrollment is added. Visual refinements must
not change the sidebar. Any inability to reproduce a specific asset exactly
must be disclosed with the resulting screenshots.

Status: user approved design and implementation on 2026-11-04.

## API correction requested on PR #178

The user's follow-up requires HTTP APIs, OpenAPI, and React Query. Replace the
new invitation Server Actions with authenticated GET/POST
`/api/sessions/{sessionId}/invitations`. GET returns owner-only groups and
invitation history; POST accepts either exact handles or a group/member selection.
Reuse the transactional use case and existing authentication policy: bearer or
login cookie for reads, bearer only for writes.
Document both operations and their shared runtime schemas in OpenAPI, including
the participant response's authoritative `totalSlots`.

The participant controller uses React Query for HTTP reads and mutations,
including the existing participant, removal, user lookup and invitation-link APIs.
Keep server-rendered participant data, optional-read failure recovery, account/session
cache isolation, mutation invalidation, and saved removal request safety. Do not
automatically retry sends or refunds. Preserve the UI and domain/payment policy.
