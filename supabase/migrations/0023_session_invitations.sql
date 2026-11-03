-- UC2-03d: host-sent session invitations. A pending invite never reserves a paid
-- participation, moves funds, or bypasses UC2-04. Accepting it uses the existing
-- user-authorized commitment path and its idempotent wallet transaction.
begin;

create table public.session_invitations (
  session_id uuid not null references public.sessions(session_id) on delete cascade,
  invitee_id uuid not null references public.profiles(user_id) on delete restrict,
  invited_by uuid not null references public.profiles(user_id) on delete restrict,
  source_group_id uuid references public.regular_groups(group_id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED')),
  invited_at timestamptz not null default statement_timestamp(),
  responded_at timestamptz,
  primary key(session_id,invitee_id),
  check(invitee_id <> invited_by),
  check ((status='PENDING') = (responded_at is null))
);

create index session_invitations_invitee_pending_idx
  on public.session_invitations(invitee_id,invited_at desc)
  where status='PENDING';
create index session_invitations_host_lookup_idx
  on public.session_invitations(session_id,status,invited_at desc);
alter table public.session_invitations enable row level security;
revoke all on public.session_invitations from public, anon, authenticated;
grant all on public.session_invitations to service_role;

-- A player accepts by joining through the existing invitation page. The
-- participation and this state change are atomic even on the waitlist.
create function public.accept_pending_session_invitation()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status in ('COMMITTED','WAITLISTED') then
    update public.session_invitations
       set status='ACCEPTED',responded_at=statement_timestamp()
     where session_id=new.session_id and invitee_id=new.user_id and status='PENDING';
  end if;
  return new;
end;
$$;
create trigger accept_pending_session_invitation
  after insert or update of status on public.participations
  for each row execute function public.accept_pending_session_invitation();

-- Reuse the notification dispatcher's existing relevance checks for all other
-- kinds, and enable push only for currently actionable session invitations.
alter function public.notification_push_relevant(text,uuid,uuid,uuid)
  rename to notification_push_relevant_before_session_invitations;
create function public.notification_push_relevant(
  p_kind text,p_recipient uuid,p_session uuid,p_group uuid
) returns boolean language sql stable set search_path='' as $$
  select case when p_kind='SESSION_INVITATION' then exists(
    select 1 from public.session_invitations i
    join public.sessions s on s.session_id=i.session_id
    where i.session_id=p_session and i.invitee_id=p_recipient
      and i.status='PENDING' and s.status='OPEN' and s.start_at>statement_timestamp()
  ) else public.notification_push_relevant_before_session_invitations(
    p_kind,p_recipient,p_session,p_group
  ) end;
$$;
revoke all on function public.notification_push_relevant(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.notification_push_relevant(text,uuid,uuid,uuid) to service_role;

comment on table public.session_invitations is
  'Recipient-specific invitations to upcoming hosted sessions; membership is accepted only through UC2-04 wallet-guarded commitment.';
commit;
