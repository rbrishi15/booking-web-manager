# ADR-0009: Role workflows and Session recording

- Status: Accepted
- Date: 2026-09-26
- Supersedes: callback-based responsibility routing in
  [ADR-0007](./0007-participant-behavior-and-session-roster.md) and
  [ADR-0008](./0008-booker-behavior-and-session-lifecycle.md).

## Context

The earlier refactors moved individual decisions into Participant and Booker,
but their public actions still delegated to Session, which called back into the
roles to authorize and calculate changes. The root remained the actor-workflow
coordinator and depended on the account roles.

Participant and Booker now run complete workflows themselves. Session accepts
prepared immutable children through bounded recording operations, checks shared
invariants, and installs the complete change. Aggregate ownership, financial
results, and business policies stay unchanged.

## Decision

### Roles own actor workflows and authorization

Applications enter actor-driven session behavior through
`user.asParticipant()` or `user.asBooker()`. The role checks actor authorization,
reads the session state it needs, prepares immutable participation/hold changes
and financial instructions, calls a Session recording operation, and returns its
result. A rejected calculation or recording leaves the session unchanged.

Participant implements joining, withdrawal, waitlist departure, replacement
offers, and `promoteFromWaitlist(session, command)`. It owns account eligibility,
access and ownership decisions, funding, hold creation, and the withdrawal
refund decision. Admission and promotion prepare both the entrant and any
replacement refund before recording either. Promotion is no longer
`Session.promoteNext`; the role preserves FIFO selection and the existing
`NONE`, `SKIPPED`, and `PROMOTED` outcomes.

Booker implements creation, cancellation, visibility changes, participant
removal, manual attendance, and settlement preparation. It authorizes ownership,
prepares every cancellation or attendance child before recording the batch, and
obtains the trusted payout destination from User. It calculates the settlement
candidate and batch before asking Session to record them. Session creation stays
in Booker, and the public Session constructor remains the validated hydration
path under ADR-0002.

Roles are the sole actor-authorization boundary. Session's lower-level methods
accept no actor IDs, User objects, or roles, and do not repeat ownership, account,
or membership authorization. Application workflows call role actions, rather
than exposing recording methods as user-facing commands. A structurally valid
candidate is not proof of actor authority.

### Session owns recording and shared invariants

The root exposes these bounded operations, all returning `void`:

- `recordAdmission(admission, refundedReplacement, now)`
- `recordParticipationTransition(existing, replacement, now?)`
- `recordCancellation(cancelled, now)`
- `recordAttendance(verifiedSubset, now)`
- `changeVisibility(visibility, now)`
- `recordSettlementPreparation(preparation, now)`

`SessionSettlementPreparation` contains `payoutId`, `idempotencyKey`, prepared
`participations`, and an optional `batch`. It is a domain-state input independent
of role command types, not a reusable workflow plan.

Recording validates the existing owned state and the allowed operation: lifecycle
and timing, record identity and transition compatibility, capacity, queue order,
hold consistency, complete cancellation coverage, attendance subsets, and
settlement/payout-history consistency as applicable. Session installs the change
only after those checks and defensive copies succeed. It keeps exclusive ownership
of its roster, queue sequence, aggregate status, pending settlement, and attempt
history; each child continues to validate its own local transitions.

These methods are not arbitrary roster setters. There is no separately applicable
public change-plan API, revision mechanism, or callback into a role. Session and
its internal helpers do not import Participant or Booker. Automatic attendance
verification, replacement expiry, and payout success/failure callbacks remain
Session operations because they do not represent an actor-role workflow.

## Consequences

- Each role action contains its complete business flow. Session has one task at
  the actor boundary: validate and record the supplied domain-state change.
  The four aggregate roots and their persistence ownership remain unchanged.
- Role suites cover authorization and actor outcomes, including deactivation
  after role creation. Session suites cover recording invariants, invalid
  candidates, unchanged state after failure, automatic operations, and payout
  callbacks. A direct recording call is intentionally not an authorization test.
- Existing business outcomes, error behavior, timestamps, IDs, financial
  instructions, and the no-payable-holds settlement result are preserved. No
  active-account restriction is added to cancellation, visibility, removal, or
  manual attendance. The exactly-30-hour withdrawal treatment and provisional
  replacement/waitlist policies remain unchanged.
- The application still saves Session and returned ledger instructions in one
  unit of work. This refactor adds no storage, schema, payment, or concurrency
  implementation; in-memory recording atomicity is not a database guarantee.
