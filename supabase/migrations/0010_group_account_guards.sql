-- UC1-04 / UC1-06: group mutations and account deactivation share profile locks.
-- 0008 and 0009 are reserved by the session work; this migration needs 0005 only.
-- Apply before deploying the GRP02 error translation. No rows or signatures change.
-- Rollback: restore save_regular_group from 0005 (removes the concurrency guard).

begin;

create or replace function public.save_regular_group(
  p_group_id uuid,
  p_owner_id uuid,
  p_name text,
  p_invitation_token text,
  p_invitation_active boolean,
  p_status text,
  p_expected_version integer,
  p_added_members jsonb,
  p_removed_members uuid[]
) returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  saved_version integer;
  account_id uuid;
  account_status text;
begin
  -- RegularGroup authorizes administration through its owner and joining through
  -- the added member. Recheck those accounts here, where eligibility and the
  -- write can be atomic. Existing inactive members can still be removed.
  -- Lock profiles before the group, in a stable order for multi-account saves.
  for account_id in
    select distinct candidate.user_id
    from (
      select coalesce(
        (select owner_id from regular_groups where group_id = p_group_id),
        p_owner_id
      ) as user_id
      union all
      select (member ->> 'user_id')::uuid
      from jsonb_array_elements(coalesce(p_added_members, '[]'::jsonb)) as member
    ) candidate
    order by candidate.user_id
  loop
    select p.account_status into account_status
      from profiles p where p.user_id = account_id for share;
    if not found then
      raise exception 'Group account % does not exist', account_id using errcode = '23503';
    end if;
    if account_status <> 'ACTIVE' then
      raise exception 'INACTIVE_ACCOUNT: group account % is inactive', account_id using errcode = 'GRP02';
    end if;
  end loop;

  -- Deactivation updates the same profile row. If this save wins, deactivation
  -- waits for commit and its obligation recheck sees the group. If deactivation
  -- wins, the locking read above sees INACTIVE and rejects this stale request.
  if p_expected_version is null then
    insert into regular_groups (group_id, owner_id, name, invitation_token, invitation_active, status, version)
    values (p_group_id, p_owner_id, p_name, p_invitation_token, p_invitation_active, p_status, 0);
    saved_version := 0;
  else
    update regular_groups
       set name = p_name,
           invitation_token = p_invitation_token,
           invitation_active = p_invitation_active,
           status = p_status,
           version = version + 1
     where group_id = p_group_id
       and version = p_expected_version
    returning version into saved_version;

    if not found then
      raise exception 'GROUP_CHANGED: group % was changed by someone else', p_group_id
        using errcode = '40001';
    end if;
  end if;

  -- Keep 0005's archive/session lock protocol and optimistic version check.
  if p_status = 'ARCHIVED' and public.count_unsettled_linked_sessions(p_group_id) > 0 then
    raise exception 'ACTIVE_OBLIGATIONS: group % has unsettled linked sessions', p_group_id
      using errcode = 'GRP01';
  end if;

  insert into group_memberships (group_id, user_id, joined_at)
  select p_group_id, (member ->> 'user_id')::uuid, (member ->> 'joined_at')::timestamptz
    from jsonb_array_elements(coalesce(p_added_members, '[]'::jsonb)) as member;

  delete from group_memberships
   where group_id = p_group_id
     and user_id = any(coalesce(p_removed_members, '{}'::uuid[]));

  return saved_version;
end;
$fn$;

revoke execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  to service_role;

commit;
