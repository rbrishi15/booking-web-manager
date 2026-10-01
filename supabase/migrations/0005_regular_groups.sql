-- 0005_regular_groups: regular groups and their members (UC1-06).
--
-- The group tables use the definitions from the earlier session migration draft
-- (#24's former 0005), so the session work can build on them unchanged. The
-- sessions table is not created here; the parts of UC1-06 that read it work
-- before and after it exists (see section 3).
--
-- Rollback (manual, in this order):
--   drop function if exists public.lock_invited_group();
--   drop function if exists public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[]);
--   drop function if exists public.count_unsettled_linked_sessions(uuid);
--   drop table if exists public.group_memberships;
--   drop table if exists public.regular_groups;
-- Data note: dropping the tables loses every group and membership, so export them first.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table regular_groups (
  group_id uuid primary key,
  owner_id uuid not null references profiles(user_id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  invitation_token text not null unique check (btrim(invitation_token) <> ''),
  invitation_active boolean not null,
  status text not null check (status in ('ACTIVE', 'ARCHIVED')),
  version integer not null default 0
);

comment on table regular_groups is
  'A regular group (RegularGroup in domain/groups). Written only through save_regular_group.';
comment on column regular_groups.version is
  'Bumped by every save_regular_group call. A save names the version it read, so a command working from an older read (e.g. a join that loaded the group before the owner revoked the link) is rejected instead of overwriting newer state.';

create table group_memberships (
  group_id uuid not null references regular_groups(group_id) on delete restrict,
  user_id uuid not null references profiles(user_id) on delete restrict,
  joined_at timestamptz not null,
  primary key (group_id, user_id)
);
create index group_memberships_user_idx on group_memberships(user_id, group_id);

-- No browser access: the app reads and writes groups on the server with the
-- service role (lib/supabase/group-store.ts).
alter table regular_groups enable row level security;
alter table group_memberships enable row level security;
revoke all on regular_groups, group_memberships from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Linked sessions, whether or not the sessions table exists yet
-- ---------------------------------------------------------------------------

-- Archiving waits until the group's linked sessions are settled (RegularGroup.archive).
-- The sessions table belongs to the session work and may not exist yet. This asks
-- Postgres itself whether it exists (not a REST "table not found" error, which can
-- be a stale cache): no table means no session can link to the group, so 0.
-- Contract for the sessions table: invited_group_id uuid, and status where
-- 'SETTLED' and 'CANCELLED' are the settled states.
create function public.count_unsettled_linked_sessions(p_group_id uuid) returns integer
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  linked integer;
begin
  if to_regclass('public.sessions') is null then
    return 0;
  end if;
  execute
    'select count(*)::integer from public.sessions
      where invited_group_id = $1 and status not in (''SETTLED'', ''CANCELLED'')'
    into linked
    using p_group_id;
  return linked;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. save_regular_group: the only way the app writes a group
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

  -- Checked again here, in case a linked session appeared after the command counted them.
  -- The row is locked by the UPDATE above; a session created with this group invited takes
  -- the same lock first (lock_invited_group, section 4), so this check can't miss one that
  -- is being created at the same moment.
  if p_status = 'ARCHIVED' and public.count_unsettled_linked_sessions(p_group_id) > 0 then
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

-- ---------------------------------------------------------------------------
-- 4. Lock for sessions linked to a group (trigger added with the sessions table)
-- ---------------------------------------------------------------------------

-- Takes a share lock on the invited group's row until the session's transaction ends.
-- save_regular_group's UPDATE needs a conflicting lock, so archiving and creating a
-- linked session can't overlap: if the session comes first, the archive waits and then
-- refuses (GRP01). It only locks; it never rejects a session.
-- Contract: the migration that creates the sessions table adds
--   create trigger sessions_lock_invited_group
--     before insert or update of invited_group_id on sessions
--     for each row execute function public.lock_invited_group();
-- security definer: FOR SHARE needs UPDATE privilege on regular_groups, which only the
-- owner and the service role have.
create function public.lock_invited_group() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.invited_group_id is not null then
    perform 1 from regular_groups where group_id = new.invited_group_id for share;
  end if;
  return new;
end;
$fn$;

-- Only the server (service role) may call these.
revoke execute on function public.count_unsettled_linked_sessions(uuid) from public, anon, authenticated;
revoke execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  from public, anon, authenticated;
revoke execute on function public.lock_invited_group() from public, anon, authenticated;
grant execute on function public.count_unsettled_linked_sessions(uuid) to service_role;
grant execute on function public.save_regular_group(uuid, uuid, text, text, boolean, text, integer, jsonb, uuid[])
  to service_role;
