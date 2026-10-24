-- 0016_user_handles: a unique, changeable public user ID (UC1-01, UC1-03; ADR-0021).
-- Telegram username rules, stored lower case so uniqueness ignores letter case.
-- Every ACTIVE account has one: existing accounts get an ID made from their name,
-- which they can change in Edit profile. Deactivated accounts release theirs.
--
-- Deploy: apply this migration with the app that sends p_handle. The previous app
-- keeps working, because update_profile's new p_handle parameter defaults to null.
-- Rollback (manual, in this order; account data is kept apart from user IDs):
--   drop function public.update_profile(uuid, text, text[], text[], text);
--   recreate update_profile(uuid, text, text[], text[]) and handle_new_user() from 0011;
--   drop trigger profiles_assign_user_handle on public.profiles;
--   drop function public.assign_missing_user_handle(), public.generate_user_handle(text, boolean);
--   alter table public.profiles drop column handle;
--   drop function public.user_handle_is_valid(text);
-- Dropping the column loses every user ID, so export them first.

begin;

-- ---------------------------------------------------------------------------
-- 1. The column, its format and its uniqueness
-- ---------------------------------------------------------------------------

-- The same rule as domain/accounts/user-handle.ts: 5-32 characters of a-z, 0-9 and
-- underscores, starting with a letter, with no trailing or repeated underscore.
create function public.user_handle_is_valid(p_handle text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_handle ~ '^[a-z][a-z0-9_]{3,30}[a-z0-9]$' and strpos(p_handle, '__') = 0;
$$;

alter table public.profiles
  add column handle text
    constraint profiles_handle_format check (public.user_handle_is_valid(handle));

-- Deactivated accounts clear their handle, so a deleted user's ID becomes free again.
create unique index profiles_handle_key on public.profiles (handle) where handle is not null;

comment on column public.profiles.handle is
  'Public user ID other players search for (UC1-01, UC1-03, ADR-0021). Lower case, unique, changeable; required while ACTIVE, null after deactivation.';

-- ---------------------------------------------------------------------------
-- 2. Generated IDs: every ACTIVE profile has one
-- ---------------------------------------------------------------------------

-- A free ID made from a name: "Marcus Lim" becomes marcus_lim, or marcus_lim_4821 when
-- that is taken. Names without usable letters become player_NNNN. p_always_suffix adds
-- the number straight away, for a seed that another transaction may be inserting.
create function public.generate_user_handle(p_seed text, p_always_suffix boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text := btrim(regexp_replace(lower(coalesce(p_seed, '')), '[^a-z0-9]+', '_', 'g'), '_');
  v_candidate text;
begin
  if v_base !~ '^[a-z]' then
    v_base := 'player_' || v_base;
  end if;
  -- Leave room for "_NNNN" within the 32-character limit.
  v_base := btrim(left(v_base, 26), '_');
  if not public.user_handle_is_valid(v_base) then
    v_base := 'player';
  end if;
  v_candidate := case when p_always_suffix then null else v_base end;
  loop
    exit when v_candidate is not null
      and not exists (select 1 from public.profiles where handle = v_candidate);
    v_candidate := v_base || '_' || (1000 + floor(random() * 9000))::int;
  end loop;
  return v_candidate;
end;
$$;

revoke execute on function public.generate_user_handle(text, boolean) from public, anon, authenticated;

create function public.assign_missing_user_handle() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_status = 'ACTIVE' and new.handle is null then
    new.handle := public.generate_user_handle(new.display_name);
  end if;
  return new;
end;
$$;

revoke execute on function public.assign_missing_user_handle() from public, anon, authenticated;

-- Covers every write path: sign-up, restoring an account after a failed deletion,
-- and any ACTIVE row written without an ID.
create trigger profiles_assign_user_handle
  before insert or update on public.profiles
  for each row execute function public.assign_missing_user_handle();

-- Existing accounts, one at a time in sign-up order, so each generated ID sees the
-- ones before it. Rewriting a null handle fires the trigger above.
do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select user_id from public.profiles
    where account_status = 'ACTIVE' and handle is null
    order by created_at, user_id
  loop
    update public.profiles set handle = null where user_id = v_user_id;
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_active_handle_required check (account_status <> 'ACTIVE' or handle is not null);

-- ---------------------------------------------------------------------------
-- 3. Sign-up: keep the chosen ID when it is valid and still free
-- ---------------------------------------------------------------------------

-- Metadata comes from the browser. Without a valid ID the trigger above generates one.
-- If another sign-up took the chosen ID after the form checked it, the account is
-- still created, with the chosen ID plus a number, which the user can change later.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text := left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60);
  v_handle text := lower(regexp_replace(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')), '^@', ''));
  v_sports text[] := array(select distinct sport from jsonb_array_elements_text(
    case when jsonb_typeof(new.raw_user_meta_data -> 'preferred_sports') = 'array'
      then new.raw_user_meta_data -> 'preferred_sports' else '[]'::jsonb end
  ) as sports(sport) where sport = any(array['Badminton','Basketball','Football','Futsal','Tennis','Volleyball']));
  v_regions text[] := array(select distinct region from jsonb_array_elements_text(
    case when jsonb_typeof(new.raw_user_meta_data -> 'preferred_regions') = 'array'
      then new.raw_user_meta_data -> 'preferred_regions' else '[]'::jsonb end
  ) as regions(region) where region = any(array['Central','East','North','North-East','West']));
begin
  if not public.user_handle_is_valid(v_handle) then
    v_handle := null;
  end if;

  begin
    insert into public.profiles (user_id, display_name, preferred_sports, preferred_regions, handle)
    values (new.id, v_name, v_sports, v_regions, v_handle);
  exception when unique_violation then
    if v_handle is null then
      raise;
    end if;
    insert into public.profiles (user_id, display_name, preferred_sports, preferred_regions, handle)
    values (new.id, v_name, v_sports, v_regions, public.generate_user_handle(v_handle, true));
  end;

  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$fn$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Profile edits: optionally set or change the user ID in the same guarded write
-- ---------------------------------------------------------------------------

-- Replaces 0011's four-argument version. Calls that omit p_handle still resolve here.
drop function public.update_profile(uuid, text, text[], text[]);

create function public.update_profile(
  p_user_id uuid,
  p_display_name text,
  p_preferred_sports text[],
  p_preferred_regions text[],
  p_handle text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
  -- The same whitespace characters as JavaScript String.trim().
  v_whitespace text := E' \t\n\r\f' || chr(11) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
    || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
    || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
    || chr(12288) || chr(65279);
  v_name text := btrim(p_display_name, v_whitespace);
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'The profile must belong to the authenticated user' using errcode = '42501';
  end if;

  -- Serialize with deactivation: a stale cookie or earlier status read cannot
  -- repopulate personal details after the account has become INACTIVE.
  select account_status into v_status from public.profiles
    where user_id = p_user_id for update;
  if not found then
    raise exception 'The profile was not found' using errcode = 'PRF03';
  end if;
  if v_status <> 'ACTIVE' then
    raise exception 'The account is inactive' using errcode = 'PRF01';
  end if;

  -- UTF-16 code units match TypeScript string.length (supplementary characters
  -- count twice), so direct RPC callers receive the same 60-character guard.
  -- The application sends user IDs already in their stored lower-case form.
  if v_name is null or char_length(v_name) = 0
    or (select coalesce(sum(case when ascii(ch) > 65535 then 2 else 1 end), 0)
        from regexp_split_to_table(v_name, '') as chars(ch)) > 60
    or p_preferred_sports is null or cardinality(p_preferred_sports) = 0
    or p_preferred_regions is null or cardinality(p_preferred_regions) = 0
    or exists (select 1 from unnest(p_preferred_sports) as sports(sport)
      where sport is null or sport <> all(array['Badminton','Basketball','Football','Futsal','Tennis','Volleyball']))
    or exists (select 1 from unnest(p_preferred_regions) as regions(region)
      where region is null or region <> all(array['Central','East','North','North-East','West']))
    or (p_handle is not null and not public.user_handle_is_valid(p_handle)) then
    raise exception 'The profile changes are invalid' using errcode = 'PRF02';
  end if;

  begin
    update public.profiles set display_name = v_name,
      preferred_sports = array(select sport from unnest(p_preferred_sports) with ordinality as sports(sport, position)
        group by sport order by min(position)),
      preferred_regions = array(select region from unnest(p_preferred_regions) with ordinality as regions(region, position)
        group by region order by min(position)),
      handle = coalesce(p_handle, handle)
      where user_id = p_user_id;
  exception when unique_violation then
    raise exception 'The user ID is already taken' using errcode = 'PRF04';
  end;
end;
$fn$;

revoke execute on function public.update_profile(uuid, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.update_profile(uuid, text, text[], text[], text) to authenticated;

commit;
