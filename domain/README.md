# Domain model

The domain is framework independent TypeScript. It imports no Next.js, database,
HTTP, or payment SDK code. Shared contracts in `/use-cases/shared` define the
boundary for future coordinators that will load authoritative state, invoke
aggregate commands, and commit returned financial instructions in one unit of
work.

## Aggregate roots

The four aggregate roots are `User`, `RegularGroup`, `Session`, and `PayoutAttempt`.
The business term Booking Room is represented by the existing Session class.
A root controls changes to its owned state and children. Actor-facing role
workflows can prepare changes for the root to validate and record.
Class comments identify each root with `Aggregate root: <Name>.` and describe
its boundary; child comments identify their owning root.

- `Session` owns its immutable `Booking` and internal immutable `ParticipantList`,
  which holds participation children and queue state. Each participation owns its
  `FundHold`. ParticipantList checks capacity, queue, identity, and collection
  transitions; Session checks lifecycle and payout conditions and installs
  complete prepared changes through bounded recording operations. It does not
  authorize actors or call role methods. Automatic verification, replacement
  expiry, and payout callbacks remain operations on the root.
- `User` owns profile/preferences, account status, its `Wallet`, and payout
  setup. The wallet holds its complete committed transaction history and derives
  spendable funds through `getAvailableBalance(): Money`. Calculated reliability and
  membership IDs are read-only related values. Ledger writes, participation
  history, and groups remain external. `User` exposes `asBooker()` and
  `asParticipant()` role views.
- `RegularGroup` owns its member list and invitation lifecycle, and requires
  unique memberships.
- `PayoutAttempt` freezes one payout batch and external destination for one payout
  attempt. A failed attempt remains a fact; a retry gets a new attempt ID.

`Wallet` is an immutable child owned by `User`; the shared `HoldingAccount`
and `LedgerTransaction` represent an identity and immutable facts rather than
aggregate roots. Account funds are derived from committed ledger entries.
`Booker` and `Participant` are role views over `User`, with no independent
repository or persisted lifecycle. Participant owns its eligibility, funding,
authorization over its records, promotion, and voluntary-departure workflows.
Booker owns complete creation, cancellation, visibility, removal, manual attendance,
and settlement-preparation workflows. The roles are the sole actor-authorization
boundary for those actions.

See [ADR-0003: Aggregate roots and boundaries](../docs/adr/0003-aggregate-roots-and-boundaries.md)
for ownership and coordination across roots, and
[ADR-0009: Role workflows and Session recording](../docs/adr/0009-role-workflows-and-session-recording.md)
for current role responsibility routing. The collection and its public query view
are defined by [ADR-0010: Session's participant list](../docs/adr/0010-session-participant-list.md).

The application enters session admission through
`user.asParticipant().join(session, command)`. The repository loads a complete
user; Participant checks its live account status, access, loaded reliability and
funds, and creates the hold from its wallet. It prepares the admission and any
replacement refund, then asks Session to validate the shared invariants and
record both. `participant.promoteFromWaitlist(session, command)` uses the same
eligibility and hold-creation behavior and preserves FIFO and skipped outcomes.
`ParticipantJoinCommand` is declared beside Participant and contains action
details only. The complete-user loading and unit-of-work contracts remain in
[ADR-0004](../docs/adr/0004-participant-join-and-session-admission.md); its earlier
admission routing is superseded by ADR-0007 and ADR-0009.

```ts
const admission = user.asParticipant().join(session, {
  participationId,
  holdId,
  now,
});
```

Public constructors accept valid domain state and validate its invariants.
Nested arguments are domain objects, such as a `Booking` and `Participation`
children for a `Session`. Repository adapters construct these objects directly
and own the mapping between storage values and domain properties.

`SessionDetails` requires explicit `payoutAttemptIds` and
`payoutIdempotencyKeys` arrays. Repositories must supply the complete histories,
including failed attempts; the constructor cannot verify their completeness.
Empty arrays mean there have been no attempts, and the creation workflow supplies
them for new sessions. Missing histories are rejected rather than inferred from
the pending payout. These histories preserve the rule that payout IDs and
idempotency keys cannot be reused after a failed attempt, following ADR-0002's
complete-state construction contract.

`UserDetails` requires a `Wallet`, `ReliabilityScore`, and membership IDs.
`WalletDetails` requires wallet/user IDs and a complete array of committed
`LedgerTransaction` objects. It validates entry types, matching wallet IDs,
unique transaction IDs, and nonnegative derived funds within safe integer cents.
History completeness is the repository's responsibility; a partial page must
never hydrate a wallet. User saves persist owned state and wallet identity,
never rewrite ledger history or persist derived funds, scores, or memberships.
Loaded transactions and related values are fixed for that instance; reload the
user and obtain a new participant after ledger or group writes before another
admission. Future transaction adapters must observe
their writes and protect against concurrent overspending.

Named creation factories remain where they apply business rules or defaults:
`User.create({ userId, email: new Email(emailText), walletId, now })` registers an active user with a
wallet with empty transactions and zero funds, empty memberships, and the
empty-history reliability default. `user.asBooker().createSession(details)` owns
the session creation workflow: booker eligibility, payout readiness, an upcoming
booking, a positive share, and initial defaults. `BookerSessionCreation` contains
the caller-supplied creation details; the role supplies identity and current
account/payout facts. `new Session(details)` validates existing state for hydration.
Children and values such as `Wallet` and `Booking` use constructors directly. Hydrating existing state
does not repeat creation workflows or reset lifecycle fields.

Child state is immutable and can be shared directly. Constructors and getters
defensively copy mutable dates, collections, and settlement data. Role workflows
prepare complete transitions and financial results before recording. Root
operations validate and copy the candidate before applying state changes;
rejected transitions leave state unchanged and throw `DomainError` with a stable
code.

`Email` is an immutable value object constructed with `new Email(text)`.
It requires exactly one `@`, nonempty parts on both sides, and no whitespace.
It preserves case and text; `equals()` compares exact text. A dotted domain is
not required, and syntax validation does not establish deliverability or uniqueness.
Invalid input throws `DomainError` with code `INVALID_INPUT`.
Registration and profile updates accept `Email`; hydration and `user.email`
use `Email | null`, with null reserved for inactive accounts. Application and
repository adapters convert incoming strings with `new Email(text)` and extract
storage/output strings with `user.email?.toString() ?? null`. Older addresses
that violate these stricter rules fail validation when loaded; they are not
silently trimmed or normalized.

See [ADR-0002: Constructor-based domain hydration](../docs/adr/0002-constructor-based-domain-hydration.md)
for construction, mapping, and encapsulation conventions.

## Participant list queries

Read participation state through `session.participantList`, a public
`ParticipantListView`. Its readonly `participations`, `nextQueueSequence`,
`committedCount`, and `reservedCount` properties describe the current collection.
Reserved count covers active, unconsumed named places. Use
`requireParticipation(id)` for a required record, `findByUserId(id)` for an
optional user lookup, `nextWaitlisted()` for the first waiter, and
`oldestAwaitingReplacement()` for the oldest eligible open-slot late withdrawal.
`personalReplacementForInvitee(userId)` finds the unique active personal
reservation addressed to that user.
The next waiter's identity is `session.participantList.nextWaitlisted()?.userId`.
`Session.getAvailableSlots(now)` applies the session's timing rules and excludes
places reserved for named personal replacements from ordinary capacity.
A captured view retains that list state; read the getter again after a successful
recording operation to obtain the new state.

The concrete ParticipantList is internal to the session package and is not an
aggregate root. Its private maps index participation and user IDs while retaining
roster order. The list owns capacity, FIFO, identity, hold/queue consistency, and
collection-transition validation. Callers receive immutable children through a
query-only view, with no mutable map or collection alias. For a recording
operation, the list builds a checked candidate; Session applies its lifecycle
and payout cross-checks before installing that candidate. Previous lists and
unchanged children remain intact.

`SessionDetails.participations` and `SessionDetails.nextQueueSequence` remain the
hydration contract; adapters supply arrays and persisted queue state. They do not
construct or save ParticipantList independently. No persistence schema changes
or compatibility getters are introduced.

## Session command calculations

Participant actions are `join`, `acceptReplacement`, `promoteFromWaitlist`,
`withdraw`, and `leaveWaitlist`. Each action performs the workflow: authorize,
read session facts, calculate immutable child changes and financial instructions,
record the complete change, then return the result. Joining, explicit replacement
acceptance, and promotion prepare the entrant and any replacement refund together.
Promotion preserves `NONE`,
`SKIPPED`, and `PROMOTED`; there is no Session promotion command.

Booker actions are `createSession`, `cancel`, `changeVisibility`,
`removeParticipant`, `verifyAttendance`, and `preparePayout`. Booker
authorizes ownership and prepares the whole cancellation, attendance, or
settlement operation before recording any state. It gets the trusted payout
destination through User; application commands contain action details rather
than raw actor or payout facts. Creation and payout-destination acquisition
retain their active-account requirements; cancellation, visibility, removal,
and manual attendance add no new active-account restriction.

Session accepts prepared immutable children through these bounded operations,
all returning `void`:

| Operation | Prepared input |
| --- | --- |
| `recordAdmission(admission, completedReplacement, now)` | New, re-entering, or promoted participation and its optional replaced participation, including any newly due refund. |
| `recordParticipationTransition(existing, replacement, now?)` | An existing participation and its permitted successor. |
| `recordCancellation(cancelled, now)` | The complete cancelled roster. |
| `recordAttendance(verifiedSubset, now)` | The subset of manually verified participations. |
| `changeVisibility(visibility, now)` | The requested visibility. |
| `recordSettlementPreparation(preparation, now)` | `SessionSettlementPreparation`: payout ID, idempotency key, candidate participations, and optional batch. |

ParticipantList validates capacity, FIFO, identity, hold/queue consistency, and
collection transitions, including cancellation coverage and attendance subsets.
Session keeps lifecycle/time guards, booking-share calculation, and payout/batch
cross-checks. It installs the candidate list with status or payout state only
after every check and defensive copy succeeds. A failed calculation or recording
leaves existing state unchanged. These operations accept no role or actor and
perform no actor authorization: a valid child change does not establish the
caller's authority. Application actor flows therefore enter through the roles.

The Session implementation and its internal helpers live in `sessions/session/`.
They have no Participant or Booker imports and never call role methods. Shared
lock/refund instruction construction remains in the internal
`sessions/participation-instructions.ts` helper. There are no arbitrary roster
setters, callback-based mutations, revision mechanism, or public workflow plans;
aggregate ownership is unchanged.

A future use case loads Session and the complete User through its transaction
repositories, invokes the appropriate Participant or Booker action, then saves
the session and applies its returned financial instructions in the same unit of
work. It does not call internal helpers or save child changes independently.
Automatic verification, replacement expiry, and payout callbacks invoke Session
directly. Payout dispatch calls the provider outside the transaction. This split
adds no use-case, database, or payment-provider implementation; domain atomicity
tests do not establish database concurrency guarantees.

## Money and booking

`Money` is an immutable signed SGD-cent value object. It uses safe integer cents,
BigInt-backed arithmetic checks, and floor division for the per-slot booking
share. `Booking` is an immutable value object requiring a positive total cost and
`startAt < endAt`. A session has at most eight commitments, including accepted
personal replacements; the booker does not receive a reserved place.

Financial operation amounts are positive and wallet balances are nonnegative at
the server boundary. A `Wallet` stores no balance field. Its synchronous
`getAvailableBalance()` sums integer cents exactly from transactions: `TOP_UP` and `REFUND`
credit, `LOCK` and wallet-withdrawal `PAYOUT` debit, and `RELEASE`/`FORFEIT`
leave spendable funds unchanged because those funds were already locked.
The result is independent of entry order; an out-of-range result throws.
Transaction collections are defensively copied, and entries are immutable.

## Participation

Participation status describes enrollment (`WAITLISTED`, `COMMITTED`,
`LEFT_WAITLIST`, `WITHDRAWN`, `REMOVED`, `CANCELLED`), while attendance and hold
states remain separate. A waitlist re-entry reuses its participation ID and gets
a new persisted queue sequence. The current implementation immediately refunds
a withdrawal more than 30 hours before start; at 30 hours or less it awaits a
replacement. This differs from the product-owner-confirmed state diagram, which
includes exactly 30 hours in the immediate-refund window. At start, unmatched
replacement holds become `FORFEITURE_DUE`. See the
[product discussion](../docs/discussions/waitlist-and-replacement-options.md)
for the source diagram and policy questions separate from that boundary issue.

## Named replacements and the joining waitlist

The user confirmed the session queue waitlist on 27 September 2026. A departing
participant has two choices: invite one named person to take their one place,
or open it to groups / the public waitlist. The choice is strictly either/or
at withdrawal and cannot be changed afterward. See
[ADR-0006](../docs/adr/0006-personal-replacement-reservations.md) for the confirmed
scope and its distinction from unresolved financial and rejoining proposals.

`Participant.withdraw` accepts `replacementMode: "DIRECT_INVITE"` with one
`replacementInviteeId`, or
`replacementMode: "OPEN_SLOT"`. Omitting the mode retains ordinary open-slot
behavior. A direct invitation reserves the departing person's one place after
early or late withdrawal. There is no replacement link or token.

The application loads the authenticated named user's participant role and calls
`acceptReplacement(session, { participationId, holdId, now })`. The user's ID
authorizes their unique active pending reservation, including access to a
private session; eligibility and funding requirements still apply. An existing
waiter can explicitly accept from any queue position. Everyone else's ordinary
order remains unchanged.

`join` and `promoteFromWaitlist` reject a named recipient with a pending
invitation without changing the reservation or existing waitlist entry. Neither
action accepts an invitation implicitly. FIFO promotion must await an invited
queue head's response rather than skip them or charge them automatically.

Successful acceptance consumes the reservation through
`replacesParticipationId`, locks the entrant's full share, and refunds the
specific late withdrawal being replaced. A previously refunded early
withdrawal receives no second refund and does not consume another withdrawal's
refund opportunity. Failed attempts preserve the reservation, funds, and any
existing queue position.

Ordinary joining and promotion for other people use only unreserved capacity,
retain the session's existing visibility/membership rules and FIFO order, and
select the oldest eligible `OPEN_SLOT` late withdrawal for a replacement refund.
The confirmation introduces no new group-selection or invitation-delivery system.

There is no action or recording transition to switch a withdrawn participant's
allocation choice. The earlier `offerPlaceToWaitlist` workflow is removed:
choosing a named replacement cannot later expose that place to ordinary
admission. This restriction concerns the departing participant's place; an
already-waitlisted named invitee can still accept it as described above.
There is no new action to decline or cancel a personal invitation. Existing
session cancellation and start rules still apply.

The repository supplies domain behavior only for this flow. It has no
departure-choice UI, invitation delivery, application coordinator, or persistence
adapter. A future coordinator must load the authenticated user, persist the
recipient with the invitation, and commit admission, reservation consumption,
and ledger instructions in one transaction. Domain atomicity does not establish
database concurrency guarantees.

## Reliability calculation

`Participation.reliabilityOutcome(asOf)` derives at most one finalized outcome:
verified attendance (manual or automatic) or a finalized late-withdrawal hold
forfeiture. Waiting, unverified, pending, refunded, removed, and other
nonterminal records are excluded. `ReliabilityScore.fromHistory` performs only the
cross-session policy: 90-day exponential half-life, session-end dating,
normalization against the newest eligible session, cutoff checks, and a precise
0–100 score. The empty-history default is 100. `User.reliabilityScore` exposes
that immutable value directly; the repository supplies the score calculated
from that user's history when loading the user.

```ts
const reliabilityScore = ReliabilityScore.fromHistory(userId, history, asOf);
```

Each history entry pairs a `Participation` with its session's `endAt`, which
determines its weight. The user ID rejects foreign history, and the explicit
`asOf` cutoff makes the calculation reproducible. The factory returns a score
without retaining the history.

## Settlement and ledger boundary

After all committed attendance is finalized,
`booker.preparePayout(session, command)` obtains the trusted destination
through User and prepares the candidate participations and frozen batch of hold
IDs, amounts, release/forfeiture reasons, and that destination. Session validates
the prepared state and payout-attempt history before recording it. The role
returns no batch when there are no payable holds. Otherwise a
future use-case coordinator saves the session, `PayoutAttempt`, and a durable payout
intent in one transaction. A dispatcher calls the external provider later. Only a matching
confirmed callback can complete that attempt; completion then settles holds and
appends `RELEASE`/`FORFEIT` ledger instructions atomically. Failure keeps holds
until a new attempt is requested; transport timeouts leave the attempt pending.

`LedgerReadPort` exposes asynchronous, derived wallet and holding-account
balances for independent queries; `WalletBalance` is not part of `User`
hydration. Unknown accounts return `null`; existing accounts with no entries
return zero. The server adapter enforces append-only entries, idempotency,
nonnegative balances, and atomic participation/hold/ledger updates. Financial
history remains after account anonymisation.

See `domain/index.ts` and `use-cases/shared/contracts.ts` for the public
contracts.

## Capability layout

The source tree follows the business capabilities and aggregate boundaries:

- `domain/sessions` contains `Session`, `Participation`, `FundHold`, and the
  `Booking` value object they own. Session's ParticipantList implementation stays
  internal; `ParticipantListView` is the exported query contract.
- `domain/groups` contains `RegularGroup` and `GroupMembership`.
- `domain/accounts` contains `User`, its Booker and Participant roles, and
  payout-account setup.
- `domain/finance` contains money, wallets, holding accounts, ledger facts,
  payouts, and derived balance read models.
- `domain/reliability` contains the reliability value object and its history
  calculation factory.
- `domain/shared` contains cross-capability statuses, IDs, errors, operations,
  and date-copying primitives.
