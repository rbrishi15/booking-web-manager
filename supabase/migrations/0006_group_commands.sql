-- 0006_group_commands: save a regular group and its membership changes in one
-- transaction (UC1-06). Requires 0005 (regular_groups, group_memberships, sessions).
--
-- Rollback (manual, in this order):
--   drop function if exists public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[]);
--   alter table regular_groups drop column if exists version;

-- ---------------------------------------------------------------------------
-- 1. A version number on every group
-- ---------------------------------------------------------------------------

alter table regular_groups add column version integer not null default 0;

comment on column regular_groups.version is
  'Bumped by every save_regular_group call. A save names the version it read, so a command working from an older read (e.g. a join that loaded the group before the owner revoked the link) is rejected instead of overwriting newer state.';

-- ---------------------------------------------------------------------------
-- 2. save_regular_group: the only way the app writes a group
-- ---------------------------------------------------------------------------

-- Everything below runs in the one transaction of the call: either the group row
-- and all membership changes are saved, or none of them are.
create function public.save_regular_group(
  p_group_id uuid,
  p_owner_id uuid,
  p_name text,
  p_invitation_token text,
  p_invitation_active boolean,
  p_status text,
  p_expected_version integer,  -- null = a new group
  p_added_members jsonb,       -- [{"user_id": "...", "joined_at": "..."}]
  p_removed_members uuid[]
) returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  saved_version integer;
begin
  if p_expected_version is null then
    -- A new group. Its owner's membership arrives in p_added_members and is inserted below,
    -- so a group can never exist without its owner.
    insert into regular_groups (group_id, owner_id, name, invitation_token, invitation_active, status, version)
    values (p_group_id, p_owner_id, p_name, p_invitation_token, p_invitation_active, p_status, 0);
    saved_version := 0;
  else
    -- An existing group: only if nobody saved it since this command read it (compare-and-set).
    -- The UPDATE also locks the row until commit, so saves of one group happen one at a time.
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

  -- Archiving waits until the group's linked sessions are settled (RegularGroup.archive).
  -- Checked again here, while the row is locked, in case a linked session appeared after the
  -- command counted them.
  if p_status = 'ARCHIVED' and exists (
    select 1
      from sessions
     where invited_group_id = p_group_id
       and status not in ('SETTLED', 'CANCELLED')
  ) then
    -- Its own SQLSTATE (not 40001): nobody else changed the group, and retrying won't help.
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

-- Only the server (service role) may call it, like the tables in 0005.
revoke execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  to service_role;
