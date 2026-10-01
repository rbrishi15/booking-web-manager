-- UC2-02: server-owned session creation and the normalized facts required to
-- hydrate a complete User. Other session/group/payout workflows are not wired.
-- Money remains integer cents; there are no cached wallet or reliability values.
--
-- Rollback (manual, in this order; foreign keys use ON DELETE RESTRICT):
--   drop table if exists public.fund_holds;
--   drop table if exists public.participations;
--   drop table if exists public.sessions;
--   drop table if exists public.group_memberships;
--   drop table if exists public.regular_groups;
--   drop table if exists public.payout_accounts;
-- Export records first: dropping populated tables loses sessions, room tokens,
-- payout setup, memberships and participation history. Reverting application
-- code does not undo this migration. UC2-02 rows in public.idempotency_keys
-- remain and could replay deleted session IDs; reconcile those replay records
-- before re-enabling session creation after a rollback.

begin;

create table payout_accounts (
  payout_account_id uuid primary key,
  user_id uuid not null unique references profiles(user_id) on delete restrict,
  provider_account_reference text not null unique
    check (btrim(provider_account_reference) <> ''),
  bank_account_reference text,
  setup_status text not null check (setup_status in ('PENDING', 'COMPLETE', 'FAILED')),
  constraint payout_accounts_bank_setup check (
    (setup_status = 'COMPLETE' and bank_account_reference is not null
      and btrim(bank_account_reference) <> '')
    or (setup_status <> 'COMPLETE' and bank_account_reference is null)
  )
);

create table regular_groups (
  group_id uuid primary key,
  owner_id uuid not null references profiles(user_id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  invitation_token text not null unique check (btrim(invitation_token) <> ''),
  invitation_active boolean not null,
  status text not null check (status in ('ACTIVE', 'ARCHIVED'))
);

create table group_memberships (
  group_id uuid not null references regular_groups(group_id) on delete restrict,
  user_id uuid not null references profiles(user_id) on delete restrict,
  joined_at timestamptz not null,
  primary key (group_id, user_id)
);
create index group_memberships_user_idx on group_memberships(user_id, group_id);

create table sessions (
  session_id uuid primary key,
  booker_id uuid not null references profiles(user_id) on delete restrict,
  venue_name text not null check (btrim(venue_name) <> ''),
  region text not null check (btrim(region) <> ''),
  sport text not null check (btrim(sport) <> ''),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  total_cost_cents bigint not null check (total_cost_cents between 1 and 9007199254740991),
  total_slots integer not null check (total_slots between 1 and 8),
  minimum_headcount integer not null check (minimum_headcount between 2 and total_slots),
  booking_share_cents bigint not null check (booking_share_cents > 0),
  constraint sessions_calculated_share check (booking_share_cents = total_cost_cents / total_slots),
  visibility text not null default 'PRIVATE' check (visibility in ('PRIVATE', 'PUBLIC')),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CANCELLED', 'AWAITING_PAYOUT', 'PAYOUT_PENDING', 'SETTLED')),
  minimum_reliability numeric check (minimum_reliability between 0 and 100),
  room_token text not null unique check (btrim(room_token) <> ''),
  holding_account_id uuid not null references holding_accounts(account_id) on delete restrict,
  -- Creation's existing domain policy accepts an optional group identity without
  -- checking existence or membership. Do not silently add that policy via a FK.
  invited_group_id uuid,
  next_queue_sequence integer not null default 1 check (next_queue_sequence > 0),
  created_at timestamptz not null default now()
);
create index sessions_booker_idx on sessions(booker_id);

create table participations (
  participation_id uuid primary key,
  session_id uuid not null references sessions(session_id) on delete restrict,
  user_id uuid not null references profiles(user_id) on delete restrict,
  status text not null
    check (status in ('WAITLISTED', 'COMMITTED', 'LEFT_WAITLIST', 'WITHDRAWN', 'REMOVED', 'CANCELLED')),
  attendance text not null check (attendance in ('UNVERIFIED', 'ATTENDED', 'ABSENT')),
  waitlisted_at timestamptz,
  committed_at timestamptz,
  withdrawn_at timestamptz,
  replacement_mode text check (replacement_mode in ('OPEN_SLOT', 'DIRECT_INVITE')),
  replacement_invitee_id uuid references profiles(user_id) on delete restrict,
  verified_at timestamptz,
  verification_method text check (verification_method in ('BOOKER', 'AUTOMATIC')),
  replaces_participation_id uuid references participations(participation_id) on delete restrict,
  queue_sequence integer check (queue_sequence > 0),
  unique (session_id, user_id),
  unique (session_id, queue_sequence),
  constraint participations_attendance_details check (
    (attendance = 'UNVERIFIED' and verified_at is null and verification_method is null)
    or (attendance <> 'UNVERIFIED' and status = 'COMMITTED'
      and verified_at is not null and verification_method is not null)
  )
);
create index participations_user_idx on participations(user_id, participation_id);

create table fund_holds (
  hold_id uuid primary key,
  participation_id uuid not null unique references participations(participation_id) on delete restrict,
  holding_account_id uuid not null references holding_accounts(account_id) on delete restrict,
  wallet_id uuid not null references wallets(wallet_id) on delete restrict,
  payout_id uuid,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  state text not null
    check (state in ('HELD', 'AWAITING_REPLACEMENT', 'FORFEITURE_DUE', 'RELEASED', 'REFUNDED', 'FORFEITED')),
  created_at timestamptz not null,
  settled_at timestamptz,
  constraint fund_holds_settlement_details check (
    (state in ('RELEASED', 'FORFEITED') and settled_at is not null and payout_id is not null)
    or (state = 'REFUNDED' and settled_at is not null and payout_id is null)
    or (state in ('HELD', 'AWAITING_REPLACEMENT', 'FORFEITURE_DUE')
      and settled_at is null and payout_id is null)
  )
);
create index fund_holds_wallet_idx on fund_holds(wallet_id);

-- Direct browser access is deliberately unavailable. Session HTTP handlers use
-- the server database connection; room tokens, payout references and histories
-- must not become visible through Supabase's auto-generated REST API.
alter table payout_accounts enable row level security;
alter table regular_groups enable row level security;
alter table group_memberships enable row level security;
alter table sessions enable row level security;
alter table participations enable row level security;
alter table fund_holds enable row level security;
revoke all on payout_accounts, regular_groups, group_memberships, sessions,
  participations, fund_holds from anon, authenticated;

commit;
