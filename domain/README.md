# Domain model

The domain is framework independent TypeScript. It imports no Next.js, database,
HTTP, or payment SDK code. Shared contracts in `/use-cases/shared` define the
boundary for future coordinators that will load authoritative state, invoke
aggregate commands, and commit returned financial instructions in one unit of
work.

## Aggregates

- `Session` owns its immutable `Booking`, participation children, waitlist order,
  and each participation's `FundHold`. Admission, withdrawal, replacement,
  cancellation, attendance, and settlement transitions are commands on the
  aggregate root.
- `User` owns profile/preferences and payout setup. Reliability is a derived
  `UserReliability` read model and cannot be assigned to a user.
- `RegularGroup` owns unique memberships and invitation lifecycle.
- `Payout` freezes one settlement batch and external destination for one payout
  attempt. A failed attempt remains a fact; a retry gets a new attempt ID.
- `Wallet`, the shared `HoldingAccount`, and `LedgerTransaction` represent
  identities and immutable facts. Their balances are ledger projections.

Entities are created with named `create(...)` factories and loaded with
`reconstitute(snapshot)`. Child state is immutable; callers receive defensive
copies. Root commands validate a complete transition before replacing the
aggregate state and throw `DomainError` with a stable code when the transition is
not allowed.

Creation contracts use domain language (`UserRegistration`, `SessionCreation`,
`GroupCreation`, and `BookingDetails`). `Snapshot` types are persistence
representations used only at the reconstitution boundary; they are not mutable
entity state or UI props.

## Money and booking

`Money` is an immutable signed SGD-cent value object. It uses safe integer cents,
BigInt-backed arithmetic checks, and floor division for the per-slot booking
share. `Booking` is an immutable value object requiring a positive total cost and
`startAt < endAt`. A session has at most eight ordinary commitments; the booker
does not receive a reserved place.

Financial operation amounts are positive and wallet balances are nonnegative at
the server boundary. A `Wallet` never stores an authoritative balance.

## Participation and reliability

Participation status describes enrollment (`WAITLISTED`, `COMMITTED`,
`LEFT_WAITLIST`, `WITHDRAWN`, `REMOVED`, `CANCELLED`), while attendance and hold
states remain separate. A waitlist re-entry reuses its participation ID and gets
a new persisted queue sequence. A withdrawal more than 30 hours before start is
refunded immediately; at 30 hours or less it awaits a replacement. At start,
unmatched replacement holds become `FORFEITURE_DUE`.

`Participation.reliabilityOutcome(asOf)` derives at most one finalized outcome:
verified attendance (manual or automatic) or a finalized late-withdrawal hold
forfeiture. Waiting, unverified, pending, refunded, removed, and other
nonterminal records are excluded. `ReliabilityService` performs only the
cross-session policy: 90-day exponential half-life, session-end dating,
normalization against the newest eligible session, cutoff checks, and a precise
0–100 score. The empty-history default is 100.

## Settlement and ledger boundary

After all committed attendance is finalized, `Session.prepareSettlement` freezes
hold IDs, amounts, release/forfeiture reasons, and the booker's payout
destination. It returns no batch when there are no payable holds. Otherwise a
future use-case coordinator saves the session, `Payout`, and a durable payout
intent in one transaction. A dispatcher calls the external provider later. Only a matching
confirmed callback can complete that attempt; completion then settles holds and
appends `RELEASE`/`FORFEIT` ledger instructions atomically. Failure keeps holds
until a new attempt is requested; transport timeouts leave the attempt pending.

`LedgerReadPort` exposes asynchronous, derived wallet and holding-account
balances. Unknown accounts return `null`; existing accounts with no entries
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
- `domain/accounts` contains `User` and payout-account setup.
- `domain/finance` contains money, wallets, holding accounts, ledger facts,
  payouts, and derived balance read models.
- `domain/reliability` contains the reliability value object, policy, and read
  model.
- `domain/shared` contains cross-capability statuses, IDs, errors, operations,
  and date-copying primitives.
