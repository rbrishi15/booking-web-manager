# ADR-0008: Booker behavior and the Session lifecycle

- Status: Accepted; callback routing superseded by ADR-0009
- Date: 2026-09-26
- Supersedes: Booker responsibility routing in
  [ADR-0003](./0003-aggregate-roots-and-boundaries.md).
- Extends: the role-and-root collaboration in
  [ADR-0007](./0007-participant-behavior-and-session-roster.md), without changing
  Participant behavior.

[ADR-0009](./0009-role-workflows-and-session-recording.md) supersedes the
Session-to-Booker callbacks and authorization placement below. Booker now runs
complete workflows and Session records prepared children. Creation ownership,
aggregate boundaries, and business behavior remain accepted; this record
preserves the earlier routing as decision history.

## Context

After moving participant decisions into `Participant`, `Booker` still forwarded
identity and payout facts to `Session`. The root continued to implement booker
creation, authorization, refunds, and manual attendance decisions as well as
shared session lifecycle rules.

We apply the same separation to Booker: the role decides what the booker can do
and prepares child transitions, while Session owns the roster and applies a
complete change. This preserves aggregate ownership and avoids giving a role
independent persistence or direct access to mutable roster state.

## Decision

`Booker.createSession(details)` owns the creation workflow. It obtains identity,
current account status, and payout readiness from its User, checks an upcoming
booking and positive share, and creates a Session with the existing defaults.
`BookerSessionCreation` is declared independently beside Booker and contains the
application-supplied booking details, IDs, tokens, and time. `Session.create` and
`SessionCreation` are removed; `new Session(details)` remains the validated
hydration path under ADR-0002, accepting valid existing lifecycle states.

The existing application-facing Booker methods retain their signatures:
`createSession`, `cancel`, `changeVisibility`, `removeParticipant`,
`verifyAttendance`, and `prepareSettlement`. For example:

```ts
const booker = user.asBooker();
const session = booker.createSession(creation);
const cancellation = booker.cancel(session, now);
```

Booker checks ownership through `assertOwnsSession(bookerId)`. Its
`prepareCancellation(participation, sessionId, now)` and
`prepareRemoval(participation, sessionId, now)` construct immutable child changes
and their refund instructions. `prepareAttendance(participation, attendance, now)`
prepares the manual `BOOKER` verification transition. `payoutDestination()` obtains
the destination from User using the existing account and payout-readiness rules.
These are domain collaboration helpers; they neither mutate nor save Session.

Session replaces the old raw-actor command methods with guarded operations:

- `applyBookerCancellation(booker, now)`
- `applyBookerVisibilityChange(booker, visibility, now)`
- `applyBookerRemoval(booker, participationId, now)`
- `applyBookerAttendance(booker, command)`
- `prepareBookerSettlement(booker, command)`

Each operation invokes the role's ownership check and enforces session-wide
conditions. Session owns lifecycle and timing checks, visibility/capacity rules,
roster lookup and iteration, duplicate attendance marks, resulting session
status, and final assignments. Cancellation calculates every child's transition
and all refunds before changing either roster or status. Attendance likewise
prepares all marks before updating any record or the session status.

Settlement obtains its trusted destination through Booker, not command fields.
The settlement command contains only payout ID, idempotency key, and time.
Session retains attendance completeness, replacement expiry, payout history,
batch creation, no-payable-holds completion, retries, and callback transitions.
Rejected preparation leaves candidate roster changes and payout-attempt history
unapplied. Direct calls to the guarded operations enforce the same role and
session checks; no raw `actorId` or destination input bypasses them.

Automatic verification, replacement expiry, participant admission and promotion,
and payout success/failure callbacks remain on Session. Immutable children keep
their transition validation. The existing public Booker surface is preserved;
removed Session entry points have no compatibility wrappers. No generic roster
setters, mutation callbacks, or independently applicable change plans are added.

## Consequences

- Booker contains business behavior while Session remains the sole owner and
  installer of session state. Roles still have no repository or persisted
  lifecycle, and aggregate ownership is unchanged.
- Booker action tests cover creation, authorization, cancellation/refunds,
  visibility, removal, and manual attendance. Session tests retain hydration,
  guarded-boundary, automatic, payout, and atomicity coverage.
- Current business behavior and financial result contracts remain unchanged.
  Creation and payout-destination acquisition retain their active-account
  checks; cancellation, visibility changes, removal, and manual attendance gain
  no new active-account restriction.
- The 30-hour withdrawal boundary and provisional replacement rules remain
  unchanged. Persistence, schema, application coordination, ledger integration,
  and database concurrency are separate work; domain tests do not establish
  those transaction guarantees.
