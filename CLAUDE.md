# Booking Web Manager

Sports venue booking coordination. One person books and pays a venue upfront,
participants commit their share into an in-app wallet where it is **held**, and
the held funds are released to the booker after attendance is verified.

The system does not reserve venues and does not take commission. Its single job
is trust: making sure the person who took the financial risk is reimbursed.

NTU SC2006 group project, Group 3.

## Before planning or making changes

Read the [ADR index](./docs/README.md), then read the relevant architecture
decision records in [docs/adr](./docs/adr) in full before planning, reviewing,
or changing code or tests. Follow links to related ADRs and implementation
guides, including the domain testing guide for domain test work.

Treat accepted ADRs as implementation constraints. If the requested change
revises an accepted decision, record the new decision in an ADR, identify which
earlier decision it supersedes, and update the index.

---

## Non-negotiable rules

Violating any of these is a bug even if tests pass.

### 1. Money is integer cents. Always.

```ts
// WRONG — will break the reconciliation invariant
const share = totalCost / slots;

// RIGHT
const share = Math.floor(totalCents / slots);
```

No `number` for currency beyond integer cents. No `double`, no `float`, no
`parseFloat`. Database columns are `bigint`. Display formatting via
`Intl.NumberFormat` at the render layer only.

### 2. Only webhooks credit wallets.

Never credit a balance from a client-side success callback. The Stripe webhook
handler is the sole writer for inbound money, with event-ID deduplication
against the `processed_events` table. A user who closes the tab must still get
their money; a replayed callback must not double-credit.

### 3. Stripe is called from `/app/wallet`, `/app/payouts` and `/api/webhooks` only.

Settlement, commitment and withdrawal logic move money through the ledger
interface, never through the Stripe SDK. This keeps the domain layer
framework-independent, which is a graded requirement (NFR maintainability).

### 4. Never call an external API inside a database transaction.

Opening a transaction, making an HTTP call, then committing holds a row lock for
the duration of the network round trip. Under concurrent load the session row
becomes a queue.

### 5. Commitment and fund lock are one transaction.

```sql
BEGIN;
  SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE;
  -- balance check, ledger entry, commitment row
COMMIT;
```

Both succeed or neither does. There must be no state where a slot is committed
without a corresponding lock, or vice versa.

### 6. Every wallet-mutating request carries an idempotency key.

A repeat key returns the original result without re-executing.

---

## Architecture

```
/domain          Pure TypeScript. No framework imports, no DB, no HTTP.
                 Business rules, policy engines, interfaces.
/use-cases       Shared ports and contracts for future use-case coordinators;
                 use-case implementations are not present yet.
/lib/money       Money type, ledger implementation, invariants.
/app             Next.js App Router. Route handlers + pages.
/components/ui   Shared design system. Request changes, don't add directly.
/supabase        Migrations (numbered, serialised) and RLS policies.
```

The dependency direction is one-way: `/app` → `/use-cases` → `/domain` → nothing.
`/domain` must never import from `/app`, `next`, `@supabase/*` or `stripe`.

### Money states

`available` → `held` → (`released` | `refunded` | `forfeited`)

`released` and `forfeited` are the same ledger movement with different reason
codes — both credit the booker. `refunded` returns to the participant.
`awaiting_replacement` is the only non-terminal branch out of `held`.

---

## Directory ownership

Changes outside your area need the owner's approval in addition to the
repository owner's.

| Area | Owner |
|---|---|
| `/domain`, `/app/wallet`, `/app/payouts`, `/api/webhooks`, CI | Rishi (also approves all PRs) |
| `/lib/money`, ledger schema, reconciliation | Harrison |
| `/app/commit`, waitlist, verification, schedulers | Yajie |
| `/app/sessions`, `/app/discover`, OneMap | Neoh |
| `/app/(auth)`, `/app/profile`, `/app/groups`, `/components/ui` | Joseph |

**Domain / ledger seam.** Rishi defines the ledger interface in `/domain` and
the business rules that call it. Harrison owns the schema, the implementation
behind that interface, and the invariants. Neither side changes the other
without review.

**Delegated review.** Approval for `/app/(auth)` and `/components/ui` may be
given by their owner, so routine interface changes don't queue behind payment
work.

Migrations are a single numbered sequence. Merge a migration PR before opening
dependent feature work — two people writing `0007` on the same day is the most
likely way this project loses an afternoon.

---

## Commands

```bash
npm run dev                    # local dev server
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
npm test                       # vitest
npm run test:concurrency       # the 20-commits-8-slots test
npx supabase start             # local Postgres
npx supabase migration new <name>
npx supabase gen types typescript --local > lib/database.types.ts
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Run `typecheck`, `lint` and `test` before opening a PR. CI runs all three.

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui ·
Supabase (Auth, Postgres, Realtime, pg_cron) · Stripe (Payment Intents for
PayNow top-up, Connect Express for payouts) · OneMap for venues ·
Web Push · Vercel `sin1` + Supabase `ap-southeast-1`

Region matters: both must be Singapore. Supabase region is fixed at project
creation and cannot be changed.

---

## Conventions

- Server-side computation for anything financial. Never trust a client-supplied
  amount, refund figure or settlement outcome.
- Validate at the boundary with Zod; the domain layer assumes valid input.
- Waitlist promotion is strictly FIFO on `joined_at`, using
  `SELECT ... FOR UPDATE SKIP LOCKED`.
- Deletion is soft. `Session.cancel()`, not `delete()`. User records are
  anonymised and retained for audit.
- SGD displays to two decimals. The applicable refund amount is shown before any
  irreversible action.
- Responsive from 390px.

---

## Key timings

| Rule | Value |
|---|---|
| Full refund window | more than 30h before session start |
| Late withdrawal | 30h or less — requires replacement or forfeits |
| Auto-verify | 72h after session **end** (not start) |
| Slot propagation | within 3s |
| Wallet operations | within 2s for 95% of requests |

---

## Testing

For domain unit tests, follow the
[domain testing guide](./tests/domain/README.md). It defines scenario naming,
Arrange/Act/Assert comments, grouping, fixtures, and error assertions. The
rationale is recorded in
[ADR-0005](./docs/adr/0005-domain-unit-test-structure.md).

Priority test, and the one most likely to catch a real bug: fire twenty
concurrent commits at an eight-slot session and assert exactly 8 succeed, 12
waitlist, and total locked equals `8 × share`.

Payment paths are tested against Stripe test mode with `stripe trigger`. Never
write a test that depends on live Stripe.

---

## Out of scope

- Live payments. Everything runs in Stripe test mode; live payouts would require
  an ACRA-registered entity with a UEN.
- Payment Services Act 2019 compliance. Documented as an out-of-scope assumption
  in the SRS, not implemented.
- Venue reservation. The platform coordinates bookings made elsewhere.

---

## Specs

Requirements, use cases, data dictionary and the class diagram live in the SRS
(`/docs`). When behaviour and the SRS disagree, the SRS wins — fix the code or
raise it, don't silently diverge. Use case IDs (`UC1-05`, `UC2-04`) are the
shared vocabulary; reference them in commit messages and PR titles.
