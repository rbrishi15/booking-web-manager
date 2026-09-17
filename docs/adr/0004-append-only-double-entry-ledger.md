# ADR-0004: Append-only double-entry ledger with derived balances

- Status: Accepted
- Date: 2026-09-17

## Context

The system's only real job is trust: a booker who paid a venue upfront must be
reimbursed, and a participant whose money is held must be able to see where it
went. Every requirement that matters financially is about what must never
happen. A wallet must never go negative. A commitment must never exist without
its fund lock, or a lock without its commitment. A replayed request must never
move money twice. A session's locked funds must always equal the sum of its
committed participants' shares.

The domain model in [`/domain`](../../domain/) already expresses money movement
as immutable facts: `LedgerTransaction` is described as an immutable financial
fact rather than an aggregate root, `WalletBalance` is "derived exclusively from
committed ledger entries, never a writable balance", and `FinancialInstruction`
carries the four movements the domain may order. What was missing was the
storage design behind those types, and a decision about where the invariants are
actually enforced.

Two obvious designs were available and both were rejected.

A **mutable balance column** on `wallets`, updated in place, is the smallest
thing that could work. It makes the balance trivially readable and the history
unrecoverable. There is no way to answer "how did this wallet reach this
figure", which is the question the system exists to answer, and a single
mis-sequenced update is undetectable after the fact.

A **ledger with balances computed on every read** keeps the history but makes a
wallet read an aggregate over the whole table, and — more seriously — leaves the
non-negative rule with nowhere to live. `SUM(...) >= 0` is not a constraint
Postgres can enforce; it can only be checked by application code that a bug or a
second writer can bypass.

## Decision

### The ledger is append-only, and the database enforces it

`ledger_entries` holds one row per money movement. `UPDATE`, `DELETE` and
`TRUNCATE` are refused by trigger, not by convention. A mistaken entry is
corrected by appending a compensating entry, which leaves both the error and the
correction visible.

Each row matches `LedgerTransaction`: a strictly positive amount plus a `kind`
that implies the direction. Storing the direction in the sign would allow a
negative `TOP_UP`, which is not a thing that exists.

### Balances are projections, maintained by trigger, with CHECK constraints

`wallet_balances`, `hold_balances` and `payout_payables` are derived state,
written only by the `apply_ledger_entry` trigger on insert. This is what gives
the safety requirements somewhere to live:

| Requirement | Where it is enforced |
| --- | --- |
| A wallet may never go negative | `wallet_balances_never_negative` CHECK |
| A hold is fully held or fully settled, never partial | `hold_balances_settled_all_or_nothing` CHECK |
| A payout cannot move more than was settled to it | `payout_payables_never_negative` CHECK |
| A repeated idempotency key cannot produce a second entry | `ledger_entries_idempotency_key_uidx` UNIQUE |
| Each kind carries exactly the references it needs | `ledger_entries_references_match_kind` CHECK |

These hold under concurrency without application-level locking. Postgres takes a
row lock for `available_cents = available_cents - n` and, under READ COMMITTED,
re-reads the committed row after waiting, so the CHECK is evaluated against the
true balance rather than a stale one.

Putting the projection maintenance in the trigger rather than in the adapter
means the invariants survive a second writer: a migration, a psql session during
a demo, or a route someone adds later.

### The double entry is a view, not a second table

Storing two rows per movement would have doubled the write path and left the
domain type mapping to two rows instead of one. Instead `ledger_postings`
expands each stored row into its two signed legs:

| Kind | Debit | Credit |
| --- | --- | --- |
| `TOP_UP` | external | wallet |
| `LOCK` | wallet | holding |
| `REFUND` | holding | wallet |
| `RELEASE` | holding | payable |
| `FORFEIT` | holding | payable |
| `PAYOUT` | payable | external |

`RELEASE` and `FORFEIT` are the same movement with different reason codes, as
CLAUDE.md states: both take money out of the hold and put it towards the
booker's payout. What distinguishes them is why, which the `kind` records.

Every entry's legs sum to zero, so the whole ledger sums to zero. Reconciliation
becomes a handful of aggregate comparisons rather than a per-operation audit,
and the `EXTERNAL` contra account is what makes the internal position directly
comparable to the payment provider's.

### Reconciliation reports, it does not repair

`reconcile_ledger()` runs every check and returns a row per check;
`run_reconciliation()` records the outcome in `reconciliation_runs` and is
scheduled hourly through pg_cron. A failure is recorded as a warning rather than
raised, because raising would roll back the record of the failure.

Nothing in reconciliation repairs a discrepancy. A ledger that silently corrects
itself cannot be audited, and being auditable is the property the whole
subsystem exists to provide.

### Reconciliation does not call the payment provider

CLAUDE.md rule 3 confines the Stripe SDK to the payments role. The provider
comparison therefore reads `provider_balance_snapshots`, a table the webhook and
payout handlers write. When no snapshot has been recorded, the check reports
that it could not run rather than passing silently.

Whether the provider's fee is subtracted from expected internal liabilities
depends on who bears it, which the snapshot records in `fees_borne_by`. The
default is `PLATFORM_ABSORBS`, because the SRS states the platform takes no
commission and a user who tops up SGD 20.00 should see SGD 20.00.

### `Money` stays in `/domain`

The workload allocation assigns the money type to the ledger role, but `Money`
already exists in `domain/finance/money.ts` and the domain rules that reason
about amounts need it without depending on infrastructure. Moving it would
invert the one-way dependency `/app` → `/use-cases` → `/domain`.

`/lib/money` therefore owns what sits between that type and the database: the
`bigint` codec, cent-exact allocation, the port adapters, idempotency and
reconciliation. `Money.divideFloor` answers "what is a third of this"; splitting
a total into parts that add back up is a different question and lives here.

## Consequences

- A wallet read is one indexed row lookup, which the two-second wallet-operation
  requirement needs, while the full history remains reconstructable.
- The projections can in principle drift from the entries behind them. That is
  the specific risk this design accepts, and checks 3, 4 and 5 of
  `reconcile_ledger()` exist to detect it.
- Adding a `TransactionKind` means changing four places together: the domain
  type, the `ledger_kind` enum, the `ledger_postings` expansion, and
  `apply_ledger_entry`. The simple `CASE` in the trigger raises `CASE_NOT_FOUND`
  on an unhandled kind rather than silently skipping it.
- Correcting an error requires a compensating entry and cannot be done by
  editing a row, which is slower to do and impossible to do unnoticed.
- The session invariant is only half-enforceable today. The ledger side is
  available as `session_held_totals`; the roster side arrives when the
  participations table is created, and the cross-check should be added to
  `reconcile_ledger()` at that point.
- The `holding_account_id` on a hold is recorded but the system runs a single
  platform account, so the per-account balance view is currently a total over
  one row.
