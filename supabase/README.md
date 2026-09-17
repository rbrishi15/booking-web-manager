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
