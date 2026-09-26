# Domain model

The domain is framework independent TypeScript. It imports no Next.js, database,
HTTP, or payment SDK code. Shared contracts in `/use-cases/shared` define the
boundary for future coordinators that will load authoritative state, invoke
aggregate commands, and commit returned financial instructions in one unit of
work.

## Aggregate roots

The four aggregate roots are `User`, `RegularGroup`, `Session`, and `Payout`.
A root is the command entry point for changing its owned state and children.
Class comments identify each root with `Aggregate root: <Name>.` and describe
its boundary; child comments identify their owning root.

- `Session` owns its immutable `Booking`, participation children, waitlist order,
  and each participation's `FundHold`. It checks shared roster rules and installs
  complete changes from Participant and Booker actions through guarded operations.
  Automatic verification, replacement expiry, promotion, and payout callbacks
  remain operations on the root.
- `User` owns profile/preferences, account status, its `Wallet`, and payout
  setup. The wallet holds its complete committed transaction history and derives
  spendable funds through `getFunds(): Money`. Calculated reliability and
  membership IDs are read-only related values. Ledger writes, participation
  history, and groups remain external. `User` exposes `asBooker()` and
  `asParticipant()` role views.
- `RegularGroup` owns unique memberships and invitation lifecycle.
- `Payout` freezes one settlement batch and external destination for one payout
  attempt. A failed attempt remains a fact; a retry gets a new attempt ID.

`Wallet` is an immutable child owned by `User`; the shared `HoldingAccount`
and `LedgerTransaction` represent an identity and immutable facts rather than
aggregate roots. Account funds are derived from committed ledger entries.
`Booker` and `Participant` are role views over `User`, with no independent
repository or persisted lifecycle. Participant owns its eligibility, funding,
authorization over its records, and voluntary-departure decisions. Booker owns
session creation, ownership authorization, cancellation/removal refund decisions,
manual attendance transitions, and payout-destination acquisition.

See [ADR-0003: Aggregate roots and boundaries](../docs/adr/0003-aggregate-roots-and-boundaries.md)
for ownership and coordination across roots, and
[ADR-0007: Participant behavior and the Session roster](../docs/adr/0007-participant-behavior-and-session-roster.md)
and [ADR-0008: Booker behavior and the Session lifecycle](../docs/adr/0008-booker-behavior-and-session-lifecycle.md)
for current role responsibility routing.

The application enters session admission through
`user.asParticipant().join(session, command)`. The repository loads a complete
user; Participant checks its live account status, loaded reliability and funds,
and creates the hold from its wallet. Session checks access, capacity, duplicate
enrollment and queue order, then applies the complete change. Promotion receives
a Participant and uses the same eligibility and hold-creation behavior.
`ParticipantJoinCommand` is declared beside Participant and contains action
details only. The complete-user loading and unit-of-work contracts remain in
[ADR-0004](../docs/adr/0004-participant-join-and-session-admission.md); its earlier
admission routing is superseded by ADR-0007.

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
Children and values such
as `Wallet` and `Booking` use constructors directly. Hydrating existing state
does not repeat creation workflows or reset lifecycle fields.

Child state is immutable and can be shared directly. Constructors and getters
defensively copy mutable dates, collections, and settlement data. Root commands
validate a complete transition and prepare their results before applying state
changes; rejected transitions leave state unchanged and throw `DomainError`
with a stable code.

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

## Session command calculations

Participant actions are `join`, `withdraw`, `leaveWaitlist`, and
`offerReplacementToWaitlist`. They collaborate with Session through
`admitParticipant`, `applyParticipantWithdrawal`, `removeWaitlistedParticipant`,
and `releaseParticipantReplacement`, respectively. These guarded operations
check session conditions, find relevant owned records, invoke Participant's
calculations, and apply the result. Direct calls still enforce ownership and
lifecycle checks. `promoteNext` remains a Session operation and verifies that its
Participant owns the front waiting record before attempting promotion.

Participant checks record ownership and prepares immutable withdrawal,
waitlist-exit, and replacement-offer transitions. It determines whether a
withdrawal receives an immediate refund or awaits replacement. Session admission
does not read User or wallet state; Session retains private access and link
validity, capacity, FIFO and re-entry rules, and the selection and refund of
another participant's awaiting withdrawal.

Booker actions are `createSession`, `cancel`, `changeVisibility`,
`removeParticipant`, `verifyAttendance`, and `prepareSettlement`. Creation is
implemented in Booker and constructs Session directly. The other actions call
`applyBookerCancellation`, `applyBookerVisibilityChange`, `applyBookerRemoval`,
`applyBookerAttendance`, and `prepareBookerSettlement`, respectively. Session
invokes Booker's ownership check, finds owned records, and obtains cancellation,
removal, and manual-attendance transitions from the role. Booker supplies the
trusted payout destination through User; commands accept no raw actor ID or
destination. The existing Booker action signatures remain unchanged.

Session owns lifecycle and timing conditions, visibility/capacity rules,
roster iteration, duplicate attendance marks, aggregate status, payout history,
and complete settlement batches. It gathers all cancellation refunds and
attendance updates before installing any roster or status change. Creation and
payout-destination acquisition retain their current active-account requirements;
cancellation, visibility changes, removal, and manual attendance add no new
active-account restriction.

`Session` owns all session state and keeps validated construction, getters, shared
lifecycle checks, payout-attempt history, and final assignments. Shared session
calculations live in four internal modules in `sessions/session/`, alongside the
root implementation. The folder entry point preserves the `sessions/session`
import path:

| Module | Responsibility |
| --- | --- |
| `sessions/session/session-validation.ts` | Construction invariants, settlement-data validation, defensive copies, and session-specific ID/date checks. |
| `sessions/session/session-roster.ts` | Shared roster operations, cancellation/manual-attendance iteration through Booker, automatic verification, attendance-derived status, and replacement expiry. |
| `sessions/session/session-admission.ts` | Access, capacity, duplicate enrollment, FIFO promotion, waitlist re-entry, replacement refunds, and collaboration with Participant eligibility and hold creation. |
| `sessions/session/session-settlement.ts` | Settlement preparation, batches, completed holds, and financial instructions. |

`sessions/participation-instructions.ts` supplies shared lock/refund instruction
construction to Participant, Booker, and the session calculations. It is an internal
helper, not a public domain export.

Calculations use operation-specific values and immutable children. They never
mutate `Session`; the root installs the change only after all calculations and
result construction succeed, including both a new commitment and any replacement
refund. A failed calculation leaves roster, queue sequence, and holds unchanged.
There are no public roster setters, arbitrary mutation callbacks, or independently
applicable change plans. The session modules are not exported from the public
domain entry point, and aggregate ownership is unchanged.

A future use case loads `Session` and any required complete `User` through its
transaction repositories, obtains the appropriate Participant or Booker role,
then saves the session and applies its financial instructions in the same unit of
work. It does not call internal helpers or save individual child changes.
Automatic operations and payout callbacks invoke Session directly. Payout dispatch
calls the provider outside the transaction.
This split adds no use-case, database, or payment-provider implementation; domain
atomicity tests do not establish database concurrency guarantees.

## Money and booking

`Money` is an immutable signed SGD-cent value object. It uses safe integer cents,
BigInt-backed arithmetic checks, and floor division for the per-slot booking
share. `Booking` is an immutable value object requiring a positive total cost and
`startAt < endAt`. A session has at most eight ordinary commitments; the booker
does not receive a reserved place.

Financial operation amounts are positive and wallet balances are nonnegative at
the server boundary. A `Wallet` stores no balance field. Its synchronous
`getFunds()` sums integer cents exactly from transactions: `TOP_UP` and `REFUND`
credit, `LOCK` and wallet-withdrawal `PAYOUT` debit, and `RELEASE`/`FORFEIT`
leave spendable funds unchanged because those funds were already locked.
The result is independent of entry order; an out-of-range result throws.
Transaction collections are defensively copied, and entries are immutable.

## Participation and reliability

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

The working copy also contains a **provisional**
`Participant.offerReplacementToWaitlist(session, { participationId, now })` action.
It lets the owning participant change an awaiting personal replacement to an
open-slot replacement before start and invalidates the personal link. It
preserves the held share and original withdrawal time and returns no financial
instructions; a refund still requires a subsequently funded replacement. This
command and its tests implement a discussion assumption, not a requirement
approved by the product owner. Personal reservation priority and other waitlist policies
remain under review in the discussion above.

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
`booker.prepareSettlement(session, command)` obtains the trusted destination
through the role and asks Session to freeze hold IDs, amounts,
release/forfeiture reasons, and that destination. Session guards payout-attempt
history and prepares the complete batch before updating state. It returns no
batch when there are no payable holds. Otherwise a
future use-case coordinator saves the session, `Payout`, and a durable payout
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
  `Booking` value object they own.
- `domain/groups` contains `RegularGroup` and `GroupMembership`.
- `domain/accounts` contains `User`, its Booker and Participant roles, and
  payout-account setup.
- `domain/finance` contains money, wallets, holding accounts, ledger facts,
  payouts, and derived balance read models.
- `domain/reliability` contains the reliability value object and its history
  calculation factory.
- `domain/shared` contains cross-capability statuses, IDs, errors, operations,
  and date-copying primitives.
