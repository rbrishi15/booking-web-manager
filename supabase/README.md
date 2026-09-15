# /supabase

Migrations (`supabase/migrations`) and RLS policies. Migrations are a single
numbered sequence shared by everyone — merge a migration PR before opening
dependent feature work. No default directory owner: whoever's feature needs a
schema change opens the migration PR; Rishi (CI owner) enforces serialisation
at review.

Run `npx supabase start` for local Postgres and `npx supabase migration new
<name>` to create the next number in sequence.

## Hosted project

Linked to `booking-web-manager` in the `sc1005-platform` org, region
`ap-southeast-1` (Singapore) — [dashboard](https://supabase.com/dashboard/project/rofrvxezteioulhlnfcj).
Get the URL, anon key and service role key from Project Settings → API and
put them in `.env.local` (see `.env.example` at the repo root) and in Vercel's
project env vars. `npx supabase link --project-ref rofrvxezteioulhlnfcj` links
a fresh checkout to this project (asks for a personal access token from
https://supabase.com/dashboard/account/tokens the first time).
