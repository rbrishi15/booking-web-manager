# /supabase

Migrations (`supabase/migrations`) and RLS policies. Migrations are a single
numbered sequence shared by everyone — merge a migration PR before opening
dependent feature work. No default directory owner: whoever's feature needs a
schema change opens the migration PR; Rishi (CI owner) enforces serialisation
at review.

Run `npx supabase start` for local Postgres and `npx supabase migration new
<name>` to create the next number in sequence.

## Current sequence

Check here before picking a number — two people writing the same one is the
most likely way this project loses an afternoon.

| # | Migration | Owner |
| --- | --- | --- |
| 0001 | `wallet_ledger` — ledger tables, balance projections, invariants | Harrison |
| 0002 | `idempotency_and_reconciliation` — keys, event de-dup, hourly job | Harrison |
| 0003 | `ledger_rls` — row level security and privileges for the ledger | Harrison |
| 0004 | `profiles` — profile table, RLS, sign-up trigger that creates the empty wallet | Joseph |
| 0005 | `session_creation` — sessions and related User state, server-only access | Neoh |

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

## Local development

The default `npm run dev` setup (README at the repo root) points at the
hosted project above, so most day-to-day feature work never touches this
section. You need local Postgres for:

- **Writing or testing a migration.** Try it locally before it touches the
  one shared hosted database everyone else is also using.
- **Running the DB-backed half of the ledger test suite** (see
  [`lib/money/README.md`](../lib/money/README.md#tests)) — the in-memory
  tests don't exercise the actual SQL, constraints or triggers.
- **Running the Session API and its integration/E2E tests**, using local Auth
  and persistence as described in [Session API](#session-api).

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
- To point the running Next.js app at local Postgres instead of hosted,
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

UC2-02 uses the real local Supabase Auth service and PostgreSQL. This setup is
separate from the shared hosted project. Keep an existing hosted `.env.local`
aside before generating local configuration; the command refuses to overwrite
one that points at a remote project.

For a fresh macOS machine, one terminal-only option is:

```bash
brew install colima docker supabase/tap/supabase
colima start --cpu 4 --memory 8
```

With any compatible runtime running:

```bash
supabase start
supabase db reset --local
npm run supabase:env
npm run seed:session
npm run dev
```

`db reset --local` deletes local development data and reapplies migrations.
Never use it against the shared hosted database. `supabase:env` writes ignored
`.env.local` and `.env.test.local` files without printing credentials. The
account preparation command creates a real local Auth user; the database
trigger provisions its profile and empty wallet. Its completed payout record
uses **development-only provider/bank references**, not verified Stripe setup.
Credentials for that prepared account are stored in the ignored
`.env.session-account.local` file.

Open [Swagger UI](http://127.0.0.1:3000/api-docs). To obtain a token, use
Supabase `signInWithPassword` with the prepared account, or the local Auth
`/auth/v1/token?grant_type=password` endpoint with the local anon key. Supply
the access token to Swagger’s **Authorize** control or send
`Authorization: Bearer <access_token>` to `POST /api/sessions`. The OpenAPI
example includes the required submission key, booking, and session config.
Retrying a key returns the original result; use a new key for a new session.

```bash
npm run test:integration
npm run test:e2e
```

Integration tests use actual SQL, domain hydration, transactions, and database
roles. Playwright builds and starts Next.js on port 3100, signs in through real
Supabase Auth, and calls the API over HTTP. It also checks the documentation
page loads. Both suites require loopback local Supabase configuration and use
unique fixture identities. Keep `LEDGER_TEST_DATABASE_URL` unset when running
them: the legacy ledger suite drops the public schema and must use its own
separate disposable database.

Session creation adds no ledger entries or payout intents. New session-related
tables enable RLS and revoke access from `anon` and `authenticated`; the trusted
server PostgreSQL connection performs creation after bearer authentication.
Complete User hydration reads all committed wallet transactions and actual
memberships and participation history, with no pagination or defaulted facts.

The CI session job resets a disposable Supabase stack, runs integration tests,
and runs Playwright against the built application. Hosted migration deployment
still occurs only through the existing `main` workflow. Apply `0004_profiles`
before `0005_session_creation`: profile and wallet provisioning are backend
requirements for bearer-authenticated session creation. Registration and
sign-in screens remain separate work.
The profile/wallet schema is carried from Joseph Wong's [PR #20](https://github.com/rbrishi15/booking-web-manager/pull/20);
coordinate migration `0004` with that PR before merging.

### Hosted Session API

For Vercel, set the server-only `DATABASE_URL` to the hosted project's Supabase
**transaction pooler** connection string with TLS and certificate verification.
Copy the endpoint and username from the project's Connect dialog. Local
development keeps the direct connection supplied by `supabase:env` on port
54322. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
for pooler selection and TLS configuration.

Each warm function instance reuses its handler and lazy pool; cold starts and
scale-out create separate instances. The initial pool has a maximum of two
connections, minimum zero, and 5-second idle and connection timeouts. Fleet-wide
usage depends on the number of instances as well as other database clients;
the application cap alone does not establish a hosted connection budget. The
[configuration guide](../use-case-config/README.md#lifetimes-and-retries) explains
the pool's Vercel lifecycle integration and local behavior.

Hosted deployment remains separate work: verify the Vercel function settings,
TLS connection configuration, and Supabase pooler/database limits against the
expected workload before deploying. Local integration and E2E checks establish
local behavior, not hosted capacity or configuration.
