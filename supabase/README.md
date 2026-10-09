# /supabase

Migrations (`supabase/migrations`) and RLS policies. Migrations are a single
numbered sequence shared by everyone — merge a migration PR before opening
dependent feature work. No default directory owner: whoever's feature needs a
schema change opens the migration PR; Rishi (CI owner) enforces serialisation
at review.

Run `npx supabase start` for local Postgres and `npx supabase migration new
<name>` to create the next number in sequence.

Every pull request checks that migration numbers are unique. Pull requests that
touch `supabase/` also run the Migration Check workflow, which applies the whole
sequence to an empty database. Merging to `main` checks the numbers again before
pushing the migrations to the hosted project.

## Current sequence

Check here before picking a number — two people writing the same one is the
most likely way this project loses an afternoon.

| # | Migration | Owner |
| --- | --- | --- |
| 0001 | `wallet_ledger` — ledger tables, balance projections, invariants | Harrison |
| 0002 | `idempotency_and_reconciliation` — keys, event de-dup, hourly job | Harrison |
| 0003 | `ledger_rls` — row level security and privileges for the ledger | Harrison |
| 0004 | `profiles` — profile table, RLS, sign-up trigger that creates the empty wallet | Joseph |
| 0005 | `regular_groups` — group tables and concurrency functions | Joseph |
| 0006 | `session_creation` — payout setup, sessions, participation and hold facts; depends on 0005 | Neoh |
| 0007 | `session_management` — complete Session history and participant ordering for UC2-03a | Neoh |
| 0008 | `session_pricing` — custom booking shares | Neoh / Harrison |
| 0009 | `commitment_scheduling` — scheduled commitment jobs and push subscriptions | Yajie |
| 0010 | `group_account_guards` — group writes share active-profile locks with account deactivation | Joseph / Rishi |
| 0011 | `profile_policy_guards` — guarded profile edits and removal of direct authenticated updates | Joseph / Rishi |

The deployed sequence ends at 0011. New migrations must use a unique number
after it; do not reuse a deployed number or insert a file below it. Supabase's
ordinary migration push rejects later-arriving files below an applied number.
The superseded `0009_session_capacity.sql` was removed before deployment because
sessions still require `minimum_headcount`; do not restore or renumber it.

Migrations 0010/0011 use tables already created by 0004/0005 and can be tested
against the current main sequence.
Apply 0011 before deploying the profile action, which calls its `update_profile`
operation. These migrations retain existing rows; rollback requires restoring
the previous function/privilege definitions, not deleting account or group data.

Apply 0007 before deploying session management. It locks the session and
participation tables while checking that existing data contains only OPEN
sessions with no participants. It aborts if legacy lifecycle data needs a
verified history/order backfill; it never deletes rows or invents that history.
See the [management configuration guide](../use-case-config/README.md#session-management-configuration).

0006 checks that 0005's group tables and `lock_invited_group()` exist and attaches
the session trigger. Merge and apply 0005 before 0006. A local database containing
the superseded draft `0005_session_creation` is not the approved sequence; do not
apply 0006 on top of it. Service-backed session tests provision their own
disposable stack; see [the integration guide](../use-case-config/README.md#validation).

0001 deliberately stops at the finance tables. `user_id`, `session_id`,
`participation_id` and `payout_id` are plain `uuid` columns with no foreign key,
because the tables they reference belong to other members and do not exist yet.
The indexes are already there, so adding each constraint is one line in the
migration that creates the referenced table.

## Hosted project

Linked to `booking-web-manager` in the `sc1005-platform` org, region
`ap-southeast-1` (Singapore) — [dashboard](https://supabase.com/dashboard/project/rofrvxezteioulhlnfcj).
Get the URL, anon key and service role key from Project Settings → API and
put them in `.env.local` (see `.env.example` at the repo root) and in Vercel's
project env vars. `npx supabase link --project-ref rofrvxezteioulhlnfcj` links
a fresh checkout to this project (asks for a personal access token from
https://supabase.com/dashboard/account/tokens the first time).

`main` auto-pushes new migrations to this project on merge — see
[`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml).
Nobody should need to run `supabase db push --linked` against it by hand;
if you find yourself doing that, something upstream of this file didn't work.

### Auth config (site URL, redirects, email confirmation)

The committed `config.toml` in this directory is the **local dev** config —
`site_url` and `additional_redirect_urls` there deliberately point at
`127.0.0.1` for `supabase start`. The hosted project's own auth settings are
separate and were pushed directly, not through this file:

| Setting | Value |
| --- | --- |
| `site_url` | `https://booking-web-manager.vercel.app` |
| `additional_redirect_urls` | `["https://booking-web-manager.vercel.app", "https://booking-web-manager.vercel.app/auth/callback"]` |
| `auth.email.enable_confirmations` | `false` — sign-up creates the account and logs in immediately |
| Custom SMTP | off — Supabase's built-in sender only |

Sign-up sends no email: Supabase creates the account, returns a session, and
the register action redirects to Home. Anyone can register with any address;
there is no proof-of-ownership step. That's deliberate for a test-mode student
project, and it's reversible — set `enable_confirmations = true` again (and
configure custom SMTP, since the built-in sender's rate limit is very low and
not configurable) if email verification is ever needed.

To change any of this yourself: write a **minimal** `config.toml` declaring
only the keys you want to change (anything undeclared is left alone), run
`supabase config diff --project-ref rofrvxezteioulhlnfcj` against it first to
confirm the blast radius is exactly what you expect, then
`supabase config push --project-ref rofrvxezteioulhlnfcj`. Secret fields
use the `env(VAR_NAME)` syntax so the real value never sits in a file —
export it in your shell first. Don't run `config push` with the
full committed `config.toml` as-is; it declares the local-dev `site_url` and
would overwrite the hosted project's correct one.

## Local development

Use local Postgres when integration work needs a disposable database. The
session contract and documentation currently need no database. Local Postgres
is useful for:

- **Writing or testing a migration.** Try it locally before it touches the
  one shared hosted database everyone else is also using.
- **Running the DB-backed half of the ledger test suite** (see
  [`lib/money/README.md`](../lib/money/README.md#tests)) — the in-memory
  tests don't exercise the actual SQL, constraints or triggers.

### Prerequisites

A running Docker-compatible container runtime and the Supabase CLI. Docker
Desktop, Colima with Docker CLI, or another compatible runtime can supply it.
The runtime is a developer preference, not an application dependency.

### Start it up

```bash
npx supabase start
```

First run pulls the Postgres/GoTrue/Studio images, so expect it to take a
few minutes; after that it's seconds. When it's done it prints a block like:

```
         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
  S3 Storage URL: http://127.0.0.1:54321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      JWT secret: ...
        anon key: ...
service_role key: ...
```

These are **local-only** credentials, always the same defaults, and
completely unrelated to the hosted project's — don't confuse the two. All
migrations in `supabase/migrations/` are applied automatically on startup, in
order.

- **Studio** (`http://127.0.0.1:54323`) is a local dashboard — browse tables,
  run SQL, inspect auth users — without touching the hosted project.
- To configure an integration against the local project,
  temporarily use the `anon key` / `API URL` above in your own
  `.env.local` in place of the `NEXT_PUBLIC_SUPABASE_*` values from
  `vercel env pull`. Don't commit that swap or push it to Vercel.

### Working on a migration

```bash
npx supabase migration new <name>   # check the table above first for the next number
# edit the new file in supabase/migrations/
npx supabase db reset                # wipes local Postgres, reapplies every migration from scratch
```

`db reset` is the important one: it's how you catch a migration that only
works if it runs after some manual step you did by hand and forgot about.
Re-run it after every edit to the migration file, not just once at the end.

### Shut down

```bash
npx supabase stop
```

Leaving it running costs you laptop resources, not correctness — nothing
breaks if you forget, but Docker Desktop will let you know.

## Session API

PR #24 currently provides the session HTTP contract and Swagger documentation.
The production `POST /api/sessions` route returns
`503 SESSION_API_UNAVAILABLE` with `Session creation is not available yet`.
It does not provision local accounts or create sessions. Run `npm run dev` and
open [Swagger UI](http://127.0.0.1:3000/api-docs) to inspect the contract without
credentials or a Supabase stack. `/api/openapi` serves the same specification.

`npm run test:e2e` builds and starts Next.js, checks the documentation, and
verifies the unavailable response. Unit and contract tests inject dependencies;
live Auth, database hydration, persistence, rollback, and concurrent replay
require integration coverage in the implementation follow-ups.

Joseph owns profile/wallet provisioning and authentication in PR #20. Neoh's
session persistence work depends on the approved profile schema. This PR adds
neither profile nor session migrations; Rishi coordinates their numbering and
merge order. See the
[configuration guide](../use-case-config/README.md#pending-integrations) for the
required interfaces, ownership, and prerequisite stack.
