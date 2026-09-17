# Design model: the wallet ledger subsystem

Lab 3 design deliverable for the wallet ledger and financial integrity area.

- **Owner:** Harrison (harr008)
- **Code:** [`/lib/money`](../../lib/money/), [`/supabase/migrations`](../../supabase/migrations/)
- **Decision record:** [ADR-0004](../adr/0004-append-only-double-entry-ledger.md)

This document covers Lab 3 §3.1 (analysis model to design model), §3.2 (key
design issues: persistent data and access control) and the design-pattern
requirement, for this subsystem only. The system-wide architecture and the
other four verticals are documented by their owners.

---

## 1. Scope and the seam with the domain layer

Every movement of money in the system passes through this subsystem. It does not
decide *whether* money should move — that is a business rule, and business rules
live in `/domain`. It decides how a movement is recorded, and it guarantees the
movement cannot leave the system in an inconsistent state.

The division of responsibility is fixed:

| Concern | Owner | Location |
| --- | --- | --- |
| The `Money` type | Domain layer role | `domain/finance/money.ts` |
| The ledger interface | Domain layer role | `domain/finance/ledger-read-port.ts`, `use-cases/shared/contracts.ts` |
| Business rules that order a movement | Domain layer role | `domain/sessions/session.ts` |
| The schema behind that interface | Ledger role | `supabase/migrations/0001–0003` |
| The implementation behind it | Ledger role | `lib/money/` |
| The invariants | Ledger role | CHECK constraints and triggers |

The domain layer issues a `FinancialInstruction`; it never writes a row. The
ledger accepts an instruction; it never decides whether the instruction was
justified. Neither side changes the other without review.

### Why `Money` did not move

The workload allocation assigns the money type to this role. It already existed
in `/domain`, with full test coverage, and the dependency direction is one-way:
`/app` → `/use-cases` → `/domain` → nothing. Moving `Money` into `/lib` would
force the domain to import from infrastructure, breaking the framework
independence that the maintainability requirements are graded on.

What `/lib/money` adds is the part that was genuinely missing. `Money.divideFloor`
answers "what is a third of this?". It does not answer "how do I split this into
three parts that add back up?" — and only the second question keeps a ledger
balanced, because SGD 10.00 split three ways is not three lots of SGD 3.33.

---

## 2. From the analysis model to the design model

The conceptual model from Lab 2 named `Wallet`, `Holding Account`, `Booking
Share` and the five money states. Three changes were made turning those into a
design model.

**The `double` type became integer cents.** The entity class diagram typed money
as a floating-point number. A `double` cannot represent SGD 0.10 exactly, so
repeated addition drifts, and a ledger that drifts is worthless. Every amount is
now an exact integer number of cents, `bigint` in the database and `Money` in
code, with no `float`, `double` or `parseFloat` anywhere in the path.

**`Wallet` lost its balance.** The conceptual model gave `Wallet` a balance
attribute and a transaction collection. In the design model `Wallet` is an
identity only, and the balance is a projection of the ledger. A balance you can
assign to is a balance that can be assigned wrongly.

**The five money states became transitions, not fields.** `Available`, `Locked`,
`Released`, `Refunded` and `Forfeited` are not values stored on a row; they are
the states a `FundHold` passes through, and each transition is a ledger entry.
The state is therefore always reconstructable from the history.

### Hold state machine (dynamic model)

```mermaid
stateDiagram-v2
    [*] --> Available : wallet funded by TOP_UP
    Available --> Held : LOCK (UC2-04 commit)
    Held --> Refunded : REFUND, withdrawal more than 30h before start
    Held --> AwaitingReplacement : withdrawal 30h or less before start
    AwaitingReplacement --> Refunded : REFUND, funded replacement found
    AwaitingReplacement --> ForfeitureDue : no replacement by session start
    ForfeitureDue --> Forfeited : FORFEIT, credits the booker
    Held --> Released : RELEASE, attendance verified (UC2-06)
    Held --> Forfeited : FORFEIT, marked absent
    Refunded --> [*]
    Released --> [*]
    Forfeited --> [*]
```

`AwaitingReplacement` is the only non-terminal branch out of `Held`. `Released`
and `Forfeited` are the same ledger movement with different reason codes: both
take money out of the hold and put it towards the booker's payout. Only
`Refunded` returns money to the participant.

The transitions themselves belong to the `Session` aggregate, owned by the
session and commitment roles. What this subsystem owns is that each arrow is
recorded exactly once and moves exactly the right amount.

---

## 3. Design class diagram

```mermaid
classDiagram
    direction LR

    class Money {
        <<entity>>
        -int cents
        +fromCents(int) Money
        +add(Money) Money
        +subtract(Money) Money
        +multiply(int) Money
        +divideFloor(int) Money
        +toCents() int
    }

    class LedgerTransaction {
        <<entity>>
        +transactionId UUID
        +amount Money
        +kind TransactionKind
        +occurredAt Date
        +idempotencyKey string
    }

    class LedgerReadPort {
        <<interface>>
        +getWalletBalance(UUID) WalletBalance
        +getHoldingAccountBalance(UUID) HoldingAccountBalance
    }

    class LedgerWritePort {
        <<interface>>
        +append(List~FinancialInstruction~) void
    }

    class SqlExecutor {
        <<interface>>
        +query(text, values) List~Row~
    }

    class LedgerUnitOfWork {
        <<control>>
        -SqlTransactor transactor
        -int maxAttempts
        +execute(request, work) T
    }

    class PostgresIdempotencyStore {
        <<control>>
        +claim(request) IdempotencyClaim
        +succeed(key, value) void
        +fail(key, reason) void
    }

    class PostgresLedgerWriter {
        <<control>>
        -string idempotencyKey
        -int sequence
        +append(instructions) void
        +creditTopUp(credit) void
        +recordPayout(debit) void
        +ensureWallet(userId) UUID
    }

    class PostgresLedgerReader {
        <<control>>
        +getWalletBalance(UUID) WalletBalance
        +getHoldingAccountBalance(UUID) HoldingAccountBalance
        +listWalletTransactions(query) List~LedgerTransaction~
        +getSessionHeldTotal(UUID) SessionHeldTotal
    }

    class Allocation {
        <<utility>>
        +bookingShare(total, slots) BookingShare
        +allocate(total, parts) List~Money~
        +sumOf(amounts) Money
        +formatSgd(money) string
    }

    class Reconciliation {
        <<utility>>
        +inspectLedger(sql) List~Check~
        +runReconciliation(sql) Report
        +assertReconciled(sql) Report
    }

    LedgerWritePort <|.. PostgresLedgerWriter
    LedgerReadPort <|.. PostgresLedgerReader
    LedgerUnitOfWork *-- PostgresLedgerWriter : creates per transaction
    LedgerUnitOfWork *-- PostgresIdempotencyStore : creates per transaction
    LedgerUnitOfWork ..> SqlExecutor : opens
    PostgresLedgerWriter ..> SqlExecutor
    PostgresLedgerReader ..> SqlExecutor
    Reconciliation ..> SqlExecutor
    PostgresLedgerReader ..> LedgerTransaction : reconstructs
    LedgerTransaction *-- Money
    Allocation ..> Money
```

Three points the diagram is making.

`PostgresLedgerWriter` is created **per transaction**, not shared. Each entry's
idempotency key is derived from the unit of work's key plus the entry's position
in the batch, so the same work replayed produces the same keys and the unique
index refuses the duplicate. A shared writer would have no such key to derive
from.

`SqlExecutor` is an interface owned by this subsystem rather than a driver
import. The Supabase client cannot hold an interactive transaction open, and a
commitment and its fund lock must share one. It also lets the concurrency test
substitute a model of row locking so the test runs in CI without a database.

Nothing in the control column touches the payment provider. The ledger moves
money between internal accounts; the provider is reached only by the payments
role, from three directories.

---

## 4. Persistent data design (Bruegge §7.4)

### Entity relationships

```mermaid
erDiagram
    wallets ||--|| wallet_balances : "projected into"
    wallets ||--o{ ledger_entries : "origin of"
    wallets ||--o{ hold_balances : "funds"
    holding_accounts ||--o{ hold_balances : pools
    holding_accounts ||--o{ ledger_entries : references
    ledger_entries }o--|| payout_payables : "settles towards"

    wallets {
        uuid wallet_id PK
        uuid user_id UK
        text currency
    }
    wallet_balances {
        uuid wallet_id PK
        bigint available_cents "CHECK >= 0"
        bigint entry_count
    }
    ledger_entries {
        uuid entry_id PK
        ledger_kind kind
        bigint amount_cents "CHECK > 0"
        text idempotency_key UK
        uuid wallet_id FK
        uuid hold_id
        uuid session_id
        uuid payout_id
    }
    hold_balances {
        uuid hold_id PK
        bigint original_cents
        bigint held_cents "CHECK >= 0"
        ledger_kind settled_kind
    }
    payout_payables {
        uuid payout_id PK
        bigint payable_cents "CHECK >= 0"
        bigint paid_out_cents
    }
    idempotency_keys {
        text idempotency_key PK
        text request_fingerprint
        idempotency_status status
        jsonb response
    }
```

`session_id`, `participation_id`, `payout_id` and `user_id` are carried as plain
`uuid` columns with no foreign key. The tables they would reference belong to
other members and do not exist yet; the indexes are already in place, so adding
the constraints is a one-line migration for whoever creates them.

### What is stored, and what is derived

Only `ledger_entries` is a fact. `wallet_balances`, `hold_balances` and
`payout_payables` are projections maintained by the `apply_ledger_entry` trigger,
and `ledger_postings`, `ledger_wallet_balances`, `holding_account_balances` and
`session_held_totals` are views over those.

Keeping the projections is a deliberate trade. Summing entries on every read
would remove the possibility of drift, but a wallet read would become an
aggregate over the whole table — against the two-second requirement — and, more
seriously, `SUM(...) >= 0` is not something Postgres can enforce. A CHECK
constraint on a stored column is. The risk the design accepts is drift between
projection and ledger, and checks 3 to 5 of `reconcile_ledger()` exist
specifically to detect it.

### Where each safety requirement is enforced

| SRS safety requirement | Mechanism | Artefact |
| --- | --- | --- |
| Unique idempotency key per wallet-mutating request; a repeat returns the original result | Claim taken in the same transaction as the work; UNIQUE index as backstop | `idempotency_keys`, `ledger_entries_idempotency_key_uidx` |
| Commitment and fund lock are one atomic transaction | Single `LedgerUnitOfWork.execute`; rollback removes both | `lib/money/ledger-unit-of-work.ts` |
| A session's locked funds equal the sum of committed shares | Ledger half derived; roster half pending | `session_held_totals` view |
| A wallet balance may never go negative | CHECK on a stored column, re-evaluated under row lock | `wallet_balances_never_negative` |
| Balances computed server-side, never trusted from the client | No write path exists over the Data API | migration 0003 |

---

## 5. Access control design (Bruegge §7.4)

The access matrix is deliberately small. There is no role that may write a
finance table over the Data API.

| Object | anonymous | authenticated user | service role (server routes) |
| --- | --- | --- | --- |
| `wallets` | — | read own | read, write |
| `wallet_balances` | — | read own | read, write via trigger |
| `ledger_entries` | — | read own entries | append only |
| `hold_balances`, `payout_payables` | — | — | read, write via trigger |
| `idempotency_keys`, `processed_events` | — | — | read, write |
| `provider_balance_snapshots` | — | — | read, write |
| `reconciliation_runs` | — | — | read, write |

Four mechanisms implement it.

**Row level security on every table**, enabled with no policy where the table is
internal, which denies by default. A user's own rows are reached through
`ledger_current_user_id()`, which returns the JWT subject or null — so a request
with no token fails every policy closed rather than open.

**No write policy anywhere.** `INSERT`, `UPDATE` and `DELETE` policies are simply
not defined for any finance table. Writes arrive only through a server route
holding the service role, which is what keeps balances, refund amounts and
settlement outcomes computed server-side as the security requirements demand.

**`security_invoker` on every view.** A view runs with its owner's privileges
unless told otherwise, which would let a user read straight past the policies
above by querying the view instead of the table. This is the specific mistake
that makes RLS look enforced when it is not.

**Append-only enforced by trigger.** Even the service role cannot rewrite
history. A mistaken entry is corrected by a compensating entry, so both the error
and the correction remain visible — which is what makes the audit trail worth
retaining for the account-deletion requirement.

---

## 6. Design patterns applied

| Pattern | Where | What it buys |
| --- | --- | --- |
| **Ports and adapters** | `LedgerReadPort` and `LedgerWritePort` defined in `/domain` and `/use-cases`, implemented in `/lib/money` | The domain stays framework-independent, which the maintainability requirements are graded on. Swapping Postgres for anything else changes one directory. |
| **Unit of Work** | `LedgerUnitOfWork` | One transaction boundary, one idempotency claim, one retry policy — in one place instead of repeated at every call site. |
| **Value Object** | `Money` | Immutable, frozen, equality by value, arithmetic that refuses to overflow silently. |
| **Projection (CQRS read model)** | `wallet_balances` and friends, maintained by trigger | Fast reads off an append-only write model, with reconciliation as the consistency proof. |
| **Idempotency key / de-duplication** | `idempotency_keys`, `processed_events` | Exactly-once effect over an at-least-once network. |
| **Compensating transaction** | Correction by appending a reversing entry | Errors are corrected without destroying the record of them. |
| **Null Object (fail-closed)** | `ledger_current_user_id()` returning null | An unauthenticated request denies rather than matching. |

---

## 7. Concurrency design

The hard case is twenty people committing to an eight-slot session at once,
which is the scenario CLAUDE.md names as the priority test.

Three mechanisms combine.

**One transaction per commitment.** The slot claim and the fund lock either both
happen or neither does. A rollback takes the slot back with it, so there is no
state where a slot is committed without a corresponding lock.

**Row locks in a fixed order.** A single-wallet batch needs no explicit locking:
the trigger's own `available_cents = available_cents - n` takes the row lock at
the right moment, and READ COMMITTED re-reads the committed value after waiting,
so the CHECK sees the true balance. Multi-wallet batches — cancelling a session
refunds everyone — take the wallet locks up front in sorted order, because two
transactions touching the same wallets in different orders would otherwise
deadlock. `for update` sits above the sort in the query plan, so the rows lock in
sorted order.

**Bounded retry on deadlock.** Lock ordering makes a deadlock unlikely, not
impossible, so `LedgerUnitOfWork` retries a transaction that fails with
`40001` or `40P01`. The rollback removed the idempotency claim too, so the
retry is a clean replay rather than a partial one.

No external API call may happen inside the transaction. Opening a transaction,
making an HTTP call and then committing holds a row lock for the duration of a
network round trip; under concurrent load the session row becomes a queue.

---

## 8. Traceability

| Requirement / use case | Design artefact | Test |
| --- | --- | --- |
| REQ-5 wallet initialised at SGD 0.00 | `wallets_create_balance` trigger | `ledger-concurrency.db.test.ts` |
| REQ-6 every user has a wallet | `PostgresLedgerWriter.ensureWallet` | `ledger-concurrency.db.test.ts` |
| REQ-7 transaction history | `PostgresLedgerReader.listWalletTransactions` | pending, with UC1-05 |
| REQ-8, REQ-9 fund states | `ledger_kind`, `hold_balances.settled_kind` | `ledger-operations.test.ts` |
| REQ-20, REQ-21 booking share | `bookingShare` | `allocation.test.ts` |
| UC1-05 wallet | ledger schema, read adapter | `ledger-operations.test.ts` |
| UC2-04 commit | `LOCK`, atomic transaction, row locks | `ledger-concurrency.test.ts`, `.db.test.ts` |
| UC2-05 withdraw | `REFUND`, `FORFEIT` | `ledger-operations.test.ts` |
| UC2-06 verify attendance | `RELEASE`, `FORFEIT` | `ledger-operations.test.ts` |
| UC1-08 withdraw funds | `PAYOUT`, `payout_payables` | `ledger-operations.test.ts` |
| Safety: no negative balance | `wallet_balances_never_negative` | both concurrency tests |
| Safety: idempotency | `idempotency_keys`, UNIQUE index | `ledger-operations.test.ts` |
| Observability | `reconcile_ledger()`, hourly pg_cron | `ledger-concurrency.db.test.ts` |

---

## 9. Testing strategy

The tests come in two halves, and the distinction matters.

`tests/lib/money/ledger-concurrency.test.ts` runs in CI with no database. It
uses an in-memory model that implements row locking as a mutex held to
transaction end. It proves the adapter and the locking discipline around it. It
does **not** prove the SQL, because it re-implements the same rules in
TypeScript — a bug in the real trigger would not show up there.

`tests/lib/money/ledger-concurrency.db.test.ts` runs the same scenarios against
real Postgres, applying the actual migrations. This is what proves the schema:
the trigger, the CHECK constraints, and `select ... for update` genuinely
serialising twenty transactions. It ends by asserting the whole ledger still
reconciles. It is skipped unless `LEDGER_TEST_DATABASE_URL` is set:

```bash
npx supabase start
LEDGER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

It drops and recreates the `public` schema, so it refuses outright to run
against anything but a loopback address. The hosted project's connection string
is one paste away in `supabase/README.md`, and losing the team's database the
week before a demo is not a recoverable mistake, so the check fails hard rather
than warning.

It also needs the `pg` driver, which is not a dependency of this project — it is
imported dynamically so that neither `tsc` nor CI has to resolve it. Install it
alongside Postgres when running this suite (`npm install --no-save pg`).

### Verification record

The migrations have been applied to **PostgreSQL 18.6** (plain) and to
**PostgreSQL 17.6** (the Supabase local stack), and every invariant probed
directly with SQL rather than inferred from a passing suite. What was confirmed
to hold on both:

| Invariant | Rejected by |
| --- | --- |
| A lock with insufficient funds | `wallet_balances_never_negative` |
| `UPDATE` or `DELETE` on a ledger entry | append-only trigger |
| `TRUNCATE` on ledger entries | append-only trigger, and separately the foreign key from `processed_events` |
| A replayed idempotency key | `ledger_entries_idempotency_key_uidx` |
| A second lock on one hold | `hold_balances_pkey` |
| Settling an already-settled hold | apply trigger, `does not match an open hold` |
| A `RELEASE` naming no payout | `ledger_entries_references_match_kind` |
| A zero-amount movement | `ledger_entries_amount_positive` |

A new wallet projects to 0 cents; a top-up credits and a lock debits; every
posting leg sums to zero across the ledger; all nine reconciliation checks pass
and `run_reconciliation()` records the result; row level security is enabled on
all ten tables and every view carries `security_invoker`.

The two conditional branches were confirmed to fire on Supabase, where their
prerequisites exist, and to be skipped on plain PostgreSQL:

| Branch | On Supabase | On plain PostgreSQL |
| --- | --- | --- |
| `wallets.user_id` → `auth.users` foreign key | created | skipped, `auth.users` absent |
| `reconcile-ledger-hourly` pg_cron job | scheduled, `0 * * * *` | skipped, pg_cron absent |

Running against Supabase is what exposed that the suite's own fixtures were
wrong: they invented user IDs, which the foreign key correctly rejected. The
fixtures now seed `auth.users` where the schema exists, so one suite covers both
deployments.

Full run, all three configurations: **222 tests pass** against Supabase, 222
against a database without the auth schema, and 219 with 3 skipped when no
database is configured, which is what CI sees.

---

## 10. What is not finished

Stated plainly so it is not mistaken for complete.

- **The session invariant is half-enforced.** `session_held_totals` gives the
  ledger side; the comparison against committed participants' shares needs the
  `participations` table, which belongs to the commitment role. The cross-check
  should be added to `reconcile_ledger()` as check 10 when that table lands.
- **No driver is wired.** `SqlExecutor` has no production implementation in the
  repository, because the driver choice belongs to the repository owner. The
  five-line `pg` implementation is given in the doc comment of
  [`lib/money/sql.ts`](../../lib/money/sql.ts).
- **`provider_balance_snapshots` has no writer.** The payments role writes it
  from the webhook and payout handlers. Until then the provider check reports
  that it could not run, rather than passing silently.
- **Foreign keys are pending** on `user_id`, `session_id`, `participation_id`
  and `payout_id`, waiting on the tables that own them.
- **The schema has only met an empty database.** Every migration applies to a
  freshly dropped `public` schema. None has yet been applied *over* an existing
  one alongside another member's migrations, which is where a numbering
  collision or an ordering assumption would surface. That risk arrives with
  migration 0004.
