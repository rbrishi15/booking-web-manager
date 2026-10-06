-- UC2-05 / UC2-06: scheduled commitment jobs and Web Push delivery.
--
-- 1. sessions.verification_reminded_at lets the scheduled sweep claim each
--    booker's "verify attendance" reminder once: the claim sets it in the same
--    UPDATE ... RETURNING, and a failed hand-off to the notifier clears it.
-- 2. Partial indexes keep the sweep's due-session queries cheap. They cover
--    OPEN sessions only, since every scheduled job ignores the others.
-- 3. push_subscriptions stores each browser's Web Push subscription. Users
--    manage only their own; the server sends through its direct connection.
--
-- Additive only: no existing column, constraint or row changes.
--
-- Rollback (manual; subscriptions and reminder marks are lost):
--   drop table if exists push_subscriptions;
--   drop index if exists sessions_open_by_end_idx, sessions_open_by_start_idx,
--     sessions_verification_reminder_due_idx;
--   alter table sessions drop column if exists verification_reminded_at;
begin;

-- ---------------------------------------------------------------------------
-- 1. Verification reminder claims (UC2-06)
-- ---------------------------------------------------------------------------

alter table sessions add column verification_reminded_at timestamptz;

comment on column sessions.verification_reminded_at is
  'When the booker was reminded to verify attendance. Set by the sweep''s claim, cleared if the reminder could not be handed to the notifier.';

-- ---------------------------------------------------------------------------
-- 2. Due-session lookups for the scheduled sweep (UC2-05, UC2-06)
-- ---------------------------------------------------------------------------

-- Forfeiture expiry and waitlist promotion look up open sessions by start.
create index sessions_open_by_start_idx
  on sessions (start_at)
  where status = 'OPEN';

-- Auto-verification looks up open sessions by end.
create index sessions_open_by_end_idx
  on sessions (end_at)
  where status = 'OPEN';

-- Reminders: ended, still open for verification, not yet reminded.
create index sessions_verification_reminder_due_idx
  on sessions (end_at)
  where status = 'OPEN' and verification_reminded_at is null;

-- ---------------------------------------------------------------------------
-- 3. Web Push subscriptions
-- ---------------------------------------------------------------------------

create table push_subscriptions (
  -- The push service's endpoint URL identifies one browser installation.
  endpoint text primary key check (btrim(endpoint) <> ''),
  user_id uuid not null references profiles (user_id) on delete cascade,
  p256dh text not null check (btrim(p256dh) <> ''),
  auth text not null check (btrim(auth) <> ''),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

comment on table push_subscriptions is
  'Web Push subscriptions (PushManager.subscribe output). Expired endpoints are removed when the push service reports 404/410.';

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select_own
  on push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_insert_own
  on push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_delete_own
  on push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Supabase grants everything on new tables by default. Users may register,
-- list and remove their own subscriptions; they cannot rewrite one in place.
revoke all on table push_subscriptions from anon, authenticated;
grant select, insert, delete on table push_subscriptions to authenticated;

commit;
