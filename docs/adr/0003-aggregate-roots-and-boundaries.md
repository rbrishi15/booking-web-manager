# ADR-0003: Aggregate roots and boundaries

- Status: Accepted
- Date: 2026-09-15

Participant responsibility routing is superseded by
[ADR-0007](./0007-participant-behavior-and-session-roster.md), and Booker routing
by [ADR-0008](./0008-booker-behavior-and-session-lifecycle.md). Aggregate ownership
and persistence boundaries remain accepted. The original routing below is kept
as decision history: role actions now contain their own rules and collaborate
with guarded Session operations.

## Context

The domain contains entities, value objects, role views, and derived facts.
An ID or a class does not by itself establish an aggregate boundary. Existing
class comments did not consistently identify the roots or explain which root
owns a child's lifecycle. In particular, a group's account owner and its
aggregate root are different concepts, and a payout attempt has a lifecycle
separate from its session.

We need explicit ownership so callers know where to send commands and future
coordinators and adapters preserve business invariants. This decision builds on
[ADR-0001: Use-case-driven development](./0001-use-case-driven-development.md)
and [ADR-0002: Constructor-based domain hydration](./0002-constructor-based-domain-hydration.md).

## Decision

### Define four aggregate roots

An aggregate groups domain state whose rules must be checked together. Its root
is the entry point for commands that change that state. The root owns its
children’s lifecycle and applies replacements returned by immutable children.

| Aggregate root | Owned state and children | Rules enforced at the boundary |
| --- | --- | --- |
| `User` | Profile, preferences, account status, `Wallet` child, optional `PayoutAccount` | Active-account operations, payout-setup transitions, valid ownership of loaded related data, and deactivation using supplied obligation facts. |
| `RegularGroup` | Group details, invitation/archive state, `GroupMembership` children | Unique membership, retaining the owner, invitation access, owner-authorized administration, and archive eligibility. |
| `Session` | `Booking`, `Participation` children and their `FundHold` children, queue order, attendance, pending settlement, payout-attempt history | Capacity and admission, waitlist ordering, withdrawal/replacement, attendance, cancellation, and session settlement. |
| `Payout` | One provider attempt's fixed settlement lines, amount, destination and idempotency key, plus status and outcome | Matching/idempotent confirmations, conflicting callbacks, and terminal success or failure. A retry creates a new attempt. |

One consistent domain model can contain several aggregates. A bounded context
defines the scope of a model; an aggregate groups objects managed as a unit.
These are distinct concepts; see Fowler's
[Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) and
[Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html) explanations.

`User` owns its immutable `Wallet` child, which holds complete committed
transactions and derives spendable funds with `getFunds(): Money`. It also
exposes a read-only `ReliabilityScore` and membership IDs. Constructors validate
wallet ownership, transaction types and ownership, unique transaction IDs, and
nonnegative derived funds within safe integer cents. Ledger writes, participation
history, and `RegularGroup` membership changes remain external. The repository
supplies the score calculated from this user's history. Saving `User` persists
owned state and wallet identity, never rewrites ledger history, and never writes
derived funds, scores, or memberships back to their sources.

Class-level JSDoc for each root starts with `Aggregate root: <Name>.` and states
its owned state and command boundary. Child comments name their owning root.
These are documentation conventions; no aggregate base class, decorator, or
marker interface is required.

### Route lifecycle changes through the owning root

- Change payout setup through `User` commands. `PayoutAccount` transitions return
  a new child, which `User` installs after validation.
- Join or administer a group through `RegularGroup`. The root checks either
  invitation access or the acting user's owner authority, as appropriate.
- Change enrollment, holds, attendance, or session settlement through `Session`.
  `Participation` and `FundHold` validate local transitions; the root decides
  when to apply them and checks rules involving the rest of the roster.
- Complete or fail a provider attempt through `Payout`. Changing a `Payout`
  alone does not settle a session's holds or append ledger entries.

Constructors remain public under ADR-0002. Adapters and tests can construct
children and roots in valid existing states. Calling a child transition produces
a new object without changing its owner. Public construction does not authorize
an application workflow to bypass root commands or persist a child replacement
independently of its root.

### Distinguish supporting domain types

- `Booker` and `Participant` are role views over `User`. `Participant.join`
  passes its fully loaded user directly to session admission. These roles have
  no independently owned lifecycle.
- `Booking`, `Email`, `Money`, and `ReliabilityScore` are immutable value objects.
- `Wallet` is an immutable child owned by `User`, with a transaction collection
  and derived funds, without a stored balance or money-movement commands.
  `HoldingAccount` remains an immutable identity with a ledger-derived balance.
- `LedgerTransaction` is an immutable financial fact. Ledger-wide append-only,
  idempotency, and balance rules belong to the ledger adapter.
- `WalletBalance` and `HoldingAccountBalance` remain derived read models for
  independent ledger queries; neither supplies the owned wallet's state.
  `ReliabilityScore.fromHistory` calculates a `ReliabilityScore` across participation
  history; it does not own that history as an aggregate. `User` exposes the
  score directly, without a separate user identity or calculation-date wrapper.

### Coordinate across roots in the application layer

Other roots can be referenced by identity or passed temporarily to a domain
command without becoming owned mutable children. `Session.join(user, command)`
and `Session.promoteNext(user, command)` read the user's current account status
and loaded related values; the session does not retain or mutate that user.
A session stores its booker and optional group IDs, and each hold stores
wallet/holding-account identities. Those references do not transfer ownership
into the session aggregate.

`Session` and `Payout` are separate roots because a session controls roster and
held funds while a payout tracks one external attempt. Fixed settlement data in
the payout describes that attempt; the session still owns its live holds.

The repository contracts load and save `User`, `RegularGroup`, `Session`, and
`Payout`. Child entities have no independent command repository. Read-side
queries may expose child information without granting independent mutation.
Storage layout and row mapping remain adapter responsibilities.

User repository reads must include its wallet and complete committed transaction
history, calculated reliability, and memberships from a consistent transaction
view. Partial transaction histories must not hydrate wallets. Transactions and
related projections are fixed for that instance; reload the user and obtain a new participant after
ledger or membership writes before another admission. Adapters must observe
transaction writes and protect against concurrent overspending. These are
contracts for future implementations, not guarantees supplied by object
references. See [ADR-0004](./0004-participant-join-and-session-admission.md).

The existing `UnitOfWork`/`DomainTransaction` contracts allow a coordinator to
combine changes to multiple roots, ledger instructions, and durable payout
intents in one transaction. A transaction may include more than one aggregate
root. External payment calls occur through dispatchers
outside that transaction. These contracts describe future orchestration; this
decision adds no coordinator or persistence implementation.

## Consequences

- A caller can identify the command entry point from a class comment and locate
  the root responsible for a child's lifecycle.
- Local validation can live on immutable children while rules spanning children
  remain on the root. Application coordinators combine effects across roots.
- Financial account IDs, role views, and derived scores do not introduce extra
  aggregates merely because they have domain types.
- Comments and the boundary table must be updated together when ownership or
  lifecycle responsibilities change. Constructor-based hydration and existing
  business behavior continue unchanged.
