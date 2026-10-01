# /lib/money

**Owner:** Harrison (harr008)

The append-only wallet ledger: derived balances, non-negative constraints, the
five money operations (lock, release, refund, forfeit, top-up credit),
idempotency, and the hourly reconciliation job.

Seam with `/domain`: Rishi defines the ledger interface and the business rules
that call it; Harrison owns the schema and implementation behind that
interface. Neither side changes the other's without review.

Design model, access-control matrix and traceability:
[`docs/design/ledger-subsystem.md`](../../docs/design/ledger-subsystem.md).
The reasoning behind the storage design:
[ADR-0004](../../docs/adr/0004-append-only-double-entry-ledger.md).

## Architectural role

This is a **ledger infrastructure module with persistence adapters**. Its
translation code performs an anti-corruption role by keeping storage-specific
representations out of domain types and ledger port inputs and results:

| Code | Translation it owns |
| --- | --- |
| `ledger-write-adapter.ts` | Maps domain `FinancialInstruction` values to validated `ledger_entries` columns. |
| `ledger-read-adapter.ts` | Maps database rows to `WalletBalance`, `HoldingAccountBalance` and `LedgerTransaction` values. |
| `cents.ts` | Converts database `bigint` representations to and from domain `Money`, rejecting lossy amounts. |
| `errors.ts` | Maps known PostgreSQL constraints and SQLSTATE codes to `LedgerError` codes. Unrecognised errors still propagate unchanged. |

For example, a UC2-04 `LOCK` instruction with `Money.fromCents(1000)` becomes a
ledger entry with `amount_cents` represented as the database parameter `"1000"`.
A balance read converts `available_cents` back into a `Money` value. The domain
can use its own money model while these adapters handle the database format.

The rest of the module supports ledger correctness: transactions, idempotency,
reconciliation and cent-exact allocation have responsibilities beyond model
translation. `SqlExecutor` is the interface to the SQL driver; the interface
alone is not an anti-corruption layer. This module does not implement the
Stripe or Supabase HTTP API integrations.

`/lib/money` is an appropriate home for this existing implementation. ACLs have
no required folder name; see the [library placement guidance](../README.md).
Domain rules and `Money` remain in `/domain`, and use cases consume their ports
without importing these concrete persistence adapters.

## Where `Money` lives

In `/domain`, not here. The business rules that reason about amounts need the
type without depending on infrastructure, and the dependency direction is
one-way: `/app` → `/use-cases` → `/domain` → nothing.

What this directory adds is the part between that type and the database.
`Money.divideFloor` answers "what is a third of this?"; it does not answer "how
do I split this into three parts that add back up?" — and only the second
question keeps a ledger balanced, because SGD 10.00 split three ways is not
three lots of SGD 3.33.

## Layout

| File | Responsibility |
| --- | --- |
| `allocation.ts` | `bookingShare` (REQ-20), cent-exact `allocate`, `sumOf`, `formatSgd` |
| `cents.ts` | The `bigint` ↔ `Money` codec. No decimal is ever parsed |
| `constants.ts` | The platform holding account seeded by migration 0001 |
| `errors.ts` | `LedgerError`, and translation of driver errors into it |
| `idempotency.ts` | The key store and request fingerprinting |
| `ledger-read-adapter.ts` | `LedgerReadPort`, plus wallet history (REQ-7) |
| `ledger-write-adapter.ts` | `LedgerWritePort`, plus top-up credit and payout |
| `ledger-unit-of-work.ts` | One transaction, one idempotency claim, retry on deadlock |
| `reconciliation.ts` | Runs `reconcile_ledger()` and reports |
| `sql.ts` | The `SqlExecutor` port, so no driver is imported here |

## Rules this directory exists to enforce

- Money is an exact integer number of cents, everywhere. No `float`, no
  `double`, no `parseFloat`. `formatSgd` separates dollars from cents by integer
  arithmetic rather than dividing by 100.
- The ledger is append-only. A mistaken entry is corrected by appending a
  compensating entry, never by editing a row.
- Balances are projections. Nothing writes a balance directly; the
  `apply_ledger_entry` trigger maintains them, so the invariants hold whichever
  client wrote the row.
- Every wallet-mutating request carries an idempotency key, claimed inside the
  same transaction as the work it guards.
- No external API call inside a transaction, and no Stripe call from this
  directory at all.

## Wiring it up

`SqlExecutor` has no production implementation in the repository, because the
driver choice belongs to the repository owner. The five-line `pg` version is in
the doc comment at the top of [`sql.ts`](./sql.ts).

```ts
const unitOfWork = new LedgerUnitOfWork(transactor);

await unitOfWork.execute(
  {
    idempotencyKey: `commit:${sessionId}:${userId}`,
    scope: "UC2-04:commit",
    request: { sessionId, userId },
  },
  async ({ ledger }) => {
    await ledger.append(admission.instructions);
    return { participationId: admission.participationId };
  },
);
```

## Tests

```bash
npm test                    # includes the CI-safe concurrency test
npm run test:concurrency    # just the concurrency tests

# the DB-backed half, against a throwaway database (needs Docker and `pg`)
npx supabase start
npm install --no-save pg
LEDGER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

The in-memory concurrency test proves the adapter and the locking discipline.
Only the DB-backed one proves the SQL — it applies the real migrations and
exercises the real constraints. Both are needed; neither substitutes for the
other.

**Status:** verified on both deployments. `typecheck`, `lint` and `test` pass,
and the migrations have been applied to PostgreSQL 18.6 (plain) and 17.6 (the
Supabase local stack), with every invariant probed directly — 222 tests pass
against a database, 219 with 3 skipped without one. The `auth.users` foreign key
and the pg_cron schedule were both observed taking effect on Supabase and being
skipped safely without it. See the verification record in
[`docs/design/ledger-subsystem.md`](../../docs/design/ledger-subsystem.md).

The DB-backed suite drops and recreates the `public` schema, so it refuses any
host that is not loopback. Do not point it at the hosted project.
