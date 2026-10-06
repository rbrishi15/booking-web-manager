-- UC1-03: profile commands use an authenticated, atomic write capability.
-- 0008/0009 are reserved for the separately owned session UI work.
-- Rishi must coordinate merging 0008/0009 before 0010/0011, and applying them
-- in that order. Do not deploy 0010/0011 until both reserved slots are filled
-- and applied to the target database.
-- Empty preferences remain valid for registration and anonymisation. An explicit
-- profile edit must supply the supported, nonempty choices required by the domain.
-- Rollback requires the previous app version: drop update_profile, restore the
-- profiles_update_own policy/column grants and handle_new_user from 0004. Keep
-- all profile and wallet rows. That rollback also restores the old policy gaps.

begin;

revoke update on public.profiles from anon, authenticated;
revoke update (display_name, preferred_sports, preferred_regions)
  on public.profiles from anon, authenticated;
drop policy profiles_update_own on public.profiles;

create function public.update_profile(
  p_user_id uuid,
  p_display_name text,
  p_preferred_sports text[],
  p_preferred_regions text[]
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
  if v_name is null or char_length(v_name) = 0
    or (select coalesce(sum(case when ascii(ch) > 65535 then 2 else 1 end), 0)
        from regexp_split_to_table(v_name, '') as chars(ch)) > 60
    or p_preferred_sports is null or cardinality(p_preferred_sports) = 0
    or p_preferred_regions is null or cardinality(p_preferred_regions) = 0
    or exists (select 1 from unnest(p_preferred_sports) as sports(sport)
      where sport is null or sport <> all(array['Badminton','Basketball','Football','Futsal','Tennis','Volleyball']))
    or exists (select 1 from unnest(p_preferred_regions) as regions(region)
      where region is null or region <> all(array['Central','East','North','North-East','West'])) then
    raise exception 'The profile changes are invalid' using errcode = 'PRF02';
  end if;

  update public.profiles set display_name = v_name,
    preferred_sports = array(select sport from unnest(p_preferred_sports) with ordinality as sports(sport, position)
      group by sport order by min(position)),
    preferred_regions = array(select region from unnest(p_preferred_regions) with ordinality as regions(region, position)
      group by region order by min(position))
    where user_id = p_user_id;
end;
$fn$;

revoke execute on function public.update_profile(uuid, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.update_profile(uuid, text, text[], text[]) to authenticated;

-- Signup metadata is another public write path. Preserve bootstrap defaults but
-- discard unsupported metadata choices instead of storing unhydratable values.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (user_id, display_name, preferred_sports, preferred_regions)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60),
    array(select distinct sport from jsonb_array_elements_text(
      case when jsonb_typeof(new.raw_user_meta_data -> 'preferred_sports') = 'array'
        then new.raw_user_meta_data -> 'preferred_sports' else '[]'::jsonb end
    ) as sports(sport) where sport = any(array['Badminton','Basketball','Football','Futsal','Tennis','Volleyball'])),
    array(select distinct region from jsonb_array_elements_text(
      case when jsonb_typeof(new.raw_user_meta_data -> 'preferred_regions') = 'array'
        then new.raw_user_meta_data -> 'preferred_regions' else '[]'::jsonb end
    ) as regions(region) where region = any(array['Central','East','North','North-East','West']))
  );
  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$fn$;

commit;
