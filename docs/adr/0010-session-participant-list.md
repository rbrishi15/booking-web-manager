# ADR-0010: Session's participant list

- Status: Accepted
- Date: 2026-09-27
- Refines: collection implementation under
  [ADR-0009](./0009-role-workflows-and-session-recording.md).

## Context

A Booking Room is represented by the existing Session aggregate. Its participant
list contains the immutable participation records and their queue order. The
root and role workflows previously queried a raw roster array in several places,
while Session separately stored the next queue sequence.

An internal immutable ParticipantList brings collection state and queries
together. This changes the representation and query interface, without changing
the role workflows, aggregate ownership, or participation policies from ADR-0009.

## Decision

Session owns one ParticipantList containing the roster and next queue sequence.
The concrete class is internal to the session package. It uses private maps
indexed by participation ID and user ID, preserves roster order, and exposes no
mutable map or collection to callers. Immutable Participation and FundHold
children remain owned by Session through the list.

`session.participantList` exposes the public, query-only `ParticipantListView`:

| Member | Meaning |
| --- | --- |
| `participations` | Readonly participation records in their preserved roster order. |
| `nextQueueSequence` | The next sequence available for a waitlist admission or re-entry. |
| `committedCount` | The number of currently committed participants. |
| `requireParticipation(id)` | The matching participation, or the existing `NOT_FOUND` error. |
| `findByUserId(id)` | The user's participation, if present. |
| `nextWaitlisted()` | The first waiting participation in FIFO order, if present. |
| `oldestAwaitingReplacement()` | The next awaiting withdrawal selected by the existing refund order, if present. |

This view replaces the direct Session getters `participations`,
`nextQueueSequence`, and `nextWaitlistedUserId`. Callers obtain the next waiter's
identity from `session.participantList.nextWaitlisted()?.userId`.
`Session.getAvailableSlots(now)` remains public and combines collection facts
with session timing. `SessionDetails` retains `participations` and
`nextQueueSequence` as hydration inputs; adapters continue to load ordinary
arrays and explicitly supplied queue state. There is no persistence or schema
migration, and the public Session class is not renamed.

Bounded Session recording operations build a candidate ParticipantList, perform
the existing aggregate checks, and install the candidate only after the entire
operation succeeds. Candidate construction neither mutates the previous list nor
changes unchanged immutable children. ParticipantList owns capacity, FIFO,
identity, hold/queue consistency, and collection-transition validation, including
admission, cancellation coverage, attendance subsets, and candidate replacement.
Its private maps and defensive collection handling preserve those invariants.
Session retains lifecycle and timing guards, booking-share calculation,
payout/batch cross-checks, settlement state, and final assignment. Failed admission,
replacement refunds, attendance, cancellation, and settlement preparation leave
both the owned list and the rest of the aggregate unchanged.

Participant and Booker continue to authorize and run actor workflows, reading
the query view before preparing child changes. Session recording still accepts
prepared domain state and does not call roles or authorize actors. There are no
public list mutators, generic roster setters, workflow plans, or revision system.
Automatic verification, replacement expiry, and payout callbacks retain their
existing Session entry points.

## Consequences

- Callers use one query vocabulary for participation lookup, queue selection,
  refund selection, and commitment counts. Public consumers depend on
  ParticipantListView rather than the internal collection implementation.
- Collection tests cover indexing, stable order, query results, capacity/FIFO,
  collection-transition validation, immutable views, and candidate isolation.
  Session tests retain integrated recording, defensive hydration, lifecycle and
  payout checks, and failed-operation atomicity; role suites retain
  workflow and authorization coverage.
- Valid workflows retain their business outcomes, financial instructions,
  timestamps, IDs, FIFO and re-entry behavior. Final candidate validation now
  rejects payout completion with `INVALID_INPUT` when an incomplete persisted
  batch would leave active holds in a settled session. The aggregate remains
  unchanged on failure; hydration and actor policies are unchanged. The
  exactly-30-hour withdrawal treatment and provisional waitlist/replacement
  policies remain separate product issues.
- Aggregate and transaction boundaries are unchanged. In-memory candidate
  isolation does not establish database concurrency guarantees.
