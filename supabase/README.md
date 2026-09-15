# /supabase

Migrations (`supabase/migrations`) and RLS policies. Migrations are a single
numbered sequence shared by everyone — merge a migration PR before opening
dependent feature work. No default directory owner: whoever's feature needs a
schema change opens the migration PR; Rishi (CI owner) enforces serialisation
at review.

Run `npx supabase start` for local Postgres and `npx supabase migration new
<name>` to create the next number in sequence.
