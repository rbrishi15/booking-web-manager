# Booking Web Manager

Sports venue booking coordination. One person books and pays a venue upfront,
participants commit their share into an in-app wallet where it is **held**, and
the held funds are released to the booker after attendance is verified.

The system does not reserve venues or take commission. Bookers may choose a
bounded per-slot price, including above-cost collection; the platform holds and
releases the accepted amount under the attendance/refund rules.
See [ADR-0012](./docs/adr/0012-booker-selected-session-pricing.md).

NTU SC2006 group project, Group 3.

## Before planning or making changes

Read the [ADR index](./docs/README.md), then read the relevant architecture
decision records in [docs/adr](./docs/adr) in full before planning, reviewing,
or changing code or tests. Follow links to related ADRs and implementation
guides, including the domain testing guide for domain test work.

Treat accepted ADRs as implementation constraints. If the requested change
revises an accepted decision, record the new decision in an ADR, identify which
earlier decision it supersedes, and update the index.

Before opening or updating a PR, reviewing another author's work, or handling
a missing dependency, read the [contribution workflow](./docs/contributing-workflow.md).
It defines author delegation, independent review, dependency handoffs and merging.

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

### 3. Stripe is called from `/app/wallet`, `/app/payouts` and `/app/api/webhooks` only.

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
/use-cases       Framework-independent coordinators, organized by use case;
                 shared ports and transaction contracts live in /shared.
/use-case-config Assembles authentication and submission-scoped use-case
                 factories; see its README when wiring a use case.
/lib/sessions    Session infrastructure adapters implementing use-case contracts.
/lib/money       Money type, ledger implementation, invariants.
/app             Next.js App Router. Route handlers + pages.
/components/ui   Shared design system. Request changes, don't add directly.
/supabase        Migrations (numbered, serialised) and RLS policies.
```

Core dependencies point inward: `/use-cases` → `/domain` → nothing. App handlers
and lib adapters depend on core contracts. The outer `/use-case-config` folder
may import app contracts, lib adapters, and use cases to assemble them; core
modules never import outward. `/domain` must never import from `/app`, `next`,
`@supabase/*` or `stripe`.

Actor-driven session workflows enter through `User`'s Participant or Booker
role, which performs actor authorization and prepares the complete change.
Session guards lifecycle and records prepared state through bounded operations; see
[ADR-0009](./docs/adr/0009-role-workflows-and-session-recording.md).
Read participation state through `session.participantList`; its query-only view
and the internal list's collection validation are defined in
[ADR-0010](./docs/adr/0010-session-participant-list.md).

### Dependency assembly and infrastructure adapters

Before changing dependency assembly or moving responsibilities between `/app`,
`/use-case-config`, and `/lib`, read the
[configuration guide](./use-case-config/README.md). Keep detailed setup examples
and dependency lifetimes in that guide.

- **`use-case-config` assembles dependencies only.** Select implementations
  through constructors and infrastructure factories using already-validated
  settings. Return app-owned dependencies and submission-scoped construction
  callbacks; API routes authenticate, parse, invoke the use case directly, and
  map responses. See [ADR-0011](./docs/adr/0011-api-routes-invoke-use-cases.md).
- **`/lib` contains concrete infrastructure adapters.** Core-facing adapters
  implement interfaces (ports) owned by `/use-cases` or `/domain`.
  Provider-specific dependencies stay outside the core.
- **External integration adapters form the anti-corruption layer.** Translate
  Supabase/Stripe payloads, database records, and provider outcomes into the
  application's own types and terminology, protecting the domain from external
  models. See the [pattern reference](https://docs.aws.amazon.com/en_en/prescriptive-guidance/latest/cloud-design-patterns/acl.html).

Keep infrastructure failures distinct from business-rule failures: database or
provider failures must not be disguised as domain validation errors.
Infrastructure helpers such as pools and clocks may also live in `/lib`;
introduce interfaces at actual seams, not for every helper.

| Owner | Responsibilities |
|---|---|
| `/app` | Environment/request validation, server dependency initialization/caching, HTTP authentication flow, parsing, response/status mapping, and OpenAPI documentation. |
| Route handler | Await the app-owned dependency getter, orchestrate HTTP, invoke the use case directly, and map request/initialization errors to responses. |
| `/lib` | External integrations, persistence, transaction/replay behavior, client options, resource caching, cleanup, and connection logging. |
| `/use-cases` and `/domain` | Application workflows and business rules, respectively. |

### Money states

`available` → `held` → (`released` | `refunded` | `forfeited`)

`released` and `forfeited` are the same ledger movement with different reason
codes — both credit the booker. `refunded` returns to the participant.
`awaiting_replacement` is the only non-terminal branch out of `held`.

---

## Directory ownership

Feature ownership applies across routes, use cases, configuration, adapters and
tests. [CODEOWNERS](./.github/CODEOWNERS) routes reviews to the relevant owner;
it does not grant editing permission or enforce a separate Rishi co-sign.
Follow the [contribution workflow](./docs/contributing-workflow.md) for author
delegation, independent review and Rishi's merge coordination.

| Area | Owner |
|---|---|
| `/domain` (including session domain), payments, shared infrastructure, CI and governance | Rishi |
| `/lib/money`, ledger schema, reconciliation | Harrison |
| `/app/commit`, waitlist, verification, schedulers | Yajie |
| Session creation/management/discovery, related API/use-case/config/adapters/tests, OneMap | Neoh |
| Authentication and its shared adapters, profiles, groups, `/components/ui` | Joseph |

**Domain / ledger seam.** Rishi defines the ledger interface in `/domain` and
the business rules that call it. Harrison owns the schema, the implementation
behind that interface, and the invariants. Neither side changes the other
without review.

Migrations retain their feature owner; Rishi coordinates the shared sequence
and merge order. Use the workflow's dependency handoff when another owner's
migration or implementation is not yet on `main`.

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
npx supabase db reset           # reapply every local migration from scratch
npx supabase db push --linked  # push to the hosted project directly (main does this for you on merge)
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
- Validate a chosen session price through `domain/sessions/pricing.ts`; omitted
  prices retain equal splitting. Persist the accepted immutable share and hydrate
  it from `booking_share_cents`. Never recalculate existing holds from booking cost.
- Validate external input with Zod in `/app`, then pass plain TypeScript DTOs
  into `/use-cases`. Keep business invariants in `/domain`.
- Waitlist promotion is strictly FIFO on `joined_at`, using
  `SELECT ... FOR UPDATE SKIP LOCKED`.
- Cancel sessions through `user.asBooker().cancel(session, now)` and retain their
  records. User records are anonymised and retained for audit.
- SGD displays to two decimals. The applicable refund amount is shown before any
  irreversible action.
- Responsive from 390px.

### Commit messages

Use semantic commit messages. For breaking changes, add `!` immediately before
the colon (`feat!:` or `feat(sessions)!:`) and include a `BREAKING CHANGE:` footer
describing the change.

Example with both `!` and a `BREAKING CHANGE` footer:

```text
feat!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
```

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
