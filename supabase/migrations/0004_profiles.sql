-- 0004_profiles: user profile and sign-up bootstrap (UC1-01, UC1-03, UC1-04).
--
-- Rollback (manual, in this order):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user();
--   drop table if exists public.profiles;
-- Data note: dropping profiles loses display names, preferences and account_status
-- (including INACTIVE flags), so export them first. While profiles rows exist, the
-- on delete restrict foreign key blocks hard-deleting their auth users (audit NFR).

-- ---------------------------------------------------------------------------
-- 1. The profiles table: one row per registered user
-- ---------------------------------------------------------------------------

create table profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 60),
  preferred_sports text[] not null default '{}',
  preferred_regions text[] not null default '{}',
  account_status text not null default 'ACTIVE'
    constraint profiles_account_status_valid check (account_status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now()
);

comment on table profiles is
  'Profile fields Supabase Auth does not hold. Matches User preferences and accountStatus in domain/accounts/user.ts. Rows are soft-deleted (INACTIVE), never removed.';

-- ---------------------------------------------------------------------------
-- 2. Security: users see and edit only their own profile
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;

create policy profiles_select_own
  on profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy profiles_update_own
  on profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Supabase grants everything on new tables by default. Take that back, then
-- allow reads and edits of name and preferences only. account_status is NOT
-- editable by users, so a deactivated account cannot reactivate itself (UC1-04).
revoke all on table profiles from anon, authenticated;
grant select on table profiles to authenticated;
grant update (display_name, preferred_sports, preferred_regions) on table profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sign-up trigger: create the profile and an empty wallet (UC1-01, REQ-5)
-- ---------------------------------------------------------------------------

-- search_path is pinned to public (not empty) because inserting into wallets
-- fires 0001's create_wallet_balance(), which uses unqualified table names.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (user_id, display_name, preferred_sports, preferred_regions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'preferred_sports')), '{}'),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'preferred_regions')), '{}')
  );

  -- Wallet identity only; migration 0001's trigger adds the SGD 0.00 balance row.
  insert into public.wallets (user_id) values (new.id);

  return new;
end;
$fn$;

-- Backfill: users who registered before this migration get a profile too, so the
-- log-in and middleware status checks find a row for everyone. Safe to re-run.
insert into public.profiles (user_id, display_name, preferred_sports, preferred_regions)
select
  u.id,
  left(coalesce(u.raw_user_meta_data ->> 'display_name', ''), 60),
  -- Old metadata may hold null, text or an object here; only expand real JSON arrays.
  case when jsonb_typeof(u.raw_user_meta_data -> 'preferred_sports') = 'array'
    then array(select jsonb_array_elements_text(u.raw_user_meta_data -> 'preferred_sports'))
    else '{}'
  end,
  case when jsonb_typeof(u.raw_user_meta_data -> 'preferred_regions') = 'array'
    then array(select jsonb_array_elements_text(u.raw_user_meta_data -> 'preferred_regions'))
    else '{}'
  end
from auth.users as u
on conflict (user_id) do nothing;

-- Only the trigger may run this privileged function; API roles cannot call it directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();