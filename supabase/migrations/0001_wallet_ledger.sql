-- 0001_wallet_ledger.sql
--
-- Wallet ledger and financial integrity.
-- Owner: Harrison (harr008). Implementation lives in /lib/money.
--
-- Scope of this migration is deliberately limited to the finance tables. The
-- users, sessions and participations tables are owned by other members and do
-- not exist yet, so user_id, session_id, participation_id and payout_id are
-- carried as plain uuid columns without foreign keys. Whoever creates those
-- tables should add the matching FK constraints in their own migration; the
-- indexes they need are already present here.
--
-- Design notes
--   * ledger_entries is append-only. UPDATE, DELETE and TRUNCATE are blocked by
--     trigger, not merely by convention.
--   * One row per money movement, matching LedgerTransaction in
--     domain/finance/ledger-transaction.ts: a positive amount plus a kind that
--     implies the direction. The ledger_postings view expands each row into its
--     two signed double-entry legs, which is what reconciliation checks.
--   * Balances are never written directly. wallet_balances, hold_balances and
--     payout_payables are projections maintained by an AFTER INSERT trigger on
--     ledger_entries, each carrying a CHECK constraint. The non-negative-balance
--     safety requirement is therefore enforced by the database and cannot be
--     bypassed by an application bug.
--   * Money is integer cents in bigint, capped at Number.MAX_SAFE_INTEGER so a
--     value can never round-trip into the TypeScript Money type unsafely.
--
-- Traceability
--   REQ-5, REQ-6, REQ-8, REQ-9   wallet, its initial zero balance and fund states
--   REQ-7                        transaction history
--   SRS 7.1 safety requirements  idempotency keys, atomic lock, session invariant,
--                                no negative balance
--   UC1-05, UC2-04, UC2-05, UC2-06, UC1-08

begin;

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- Mirrors TransactionKind in domain/shared/statuses.ts. Adding a value here
-- requires the matching change in the domain type, in ledger_postings and in
-- apply_ledger_entry().
create type ledger_kind as enum (
  'TOP_UP',
  'LOCK',
  'RELEASE',
  'REFUND',
  'FORFEIT',
  'PAYOUT'
);

-- The four account classes money can sit in. EXTERNAL is the contra account
-- standing for the payment provider, which is what makes every entry balance.
create type ledger_account_type as enum (
  'WALLET',
  'HOLDING',
  'PAYABLE',
  'EXTERNAL'
);

create type idempotency_status as enum (
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED'
);

-- Who bears the payment provider's fee. The SRS states the platform takes no
-- commission, so the default is that the platform absorbs the fee and a user
-- who tops up SGD 20.00 sees SGD 20.00. Reconciliation reads this to decide
-- whether fees should be subtracted from expected internal liabilities.
create type fee_policy as enum (
  'PLATFORM_ABSORBS',
  'USER_PAYS'
);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table holding_accounts (
  account_id uuid primary key default gen_random_uuid(),
  label text not null unique,
  created_at timestamptz not null default now()
);

comment on table holding_accounts is
  'Platform accounts pooling committed participant funds. The system runs a single row; the table exists so no account identifier is hard-coded.';

insert into holding_accounts (account_id, label)
values ('00000000-0000-4000-8000-000000000001', 'platform');

create table wallets (
  wallet_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  currency text not null default 'SGD',
  created_at timestamptz not null default now(),
  constraint wallets_currency_is_sgd check (currency = 'SGD')
);

comment on table wallets is
  'Wallet identity only. It holds no balance column: balances are projections of the append-only ledger. Matches Wallet in domain/finance/wallet.ts.';

-- Supabase Auth owns auth.users. Added conditionally so this migration also
-- applies to a plain Postgres instance, which the DB-backed tests use.
do $fk$
begin
  if to_regclass('auth.users') is not null then
    alter table wallets
      add constraint wallets_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete restrict;
  end if;
end;
$fk$;

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table ledger_entries (
  entry_id uuid primary key default gen_random_uuid(),
  kind ledger_kind not null,
  amount_cents bigint not null,
  currency text not null default 'SGD',
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null,
  external_reference text,
  wallet_id uuid references wallets (wallet_id) on delete restrict,
  holding_account_id uuid references holding_accounts (account_id) on delete restrict,
  hold_id uuid,
  session_id uuid,
  participation_id uuid,
  payout_id uuid,

  -- LedgerTransaction requires a strictly positive amount; direction comes from
  -- the kind, never from the sign.
  constraint ledger_entries_amount_positive
    check (amount_cents > 0),

  -- Number.MAX_SAFE_INTEGER. Guarantees every stored value survives the trip
  -- into Money.fromCents() without loss.
  constraint ledger_entries_amount_within_safe_integer
    check (amount_cents <= 9007199254740991),

  constraint ledger_entries_currency_is_sgd
    check (currency = 'SGD'),

  constraint ledger_entries_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),

  -- Each kind requires exactly the references its posting legs consume, and
  -- forbids the rest. This is what stops a LOCK without a hold, or a RELEASE
  -- that names no payout.
  constraint ledger_entries_references_match_kind check (
    case kind
      when 'TOP_UP' then
        wallet_id is not null
        and external_reference is not null
        and holding_account_id is null
        and hold_id is null
        and participation_id is null
        and payout_id is null
      when 'LOCK' then
        wallet_id is not null
        and holding_account_id is not null
        and hold_id is not null
        and session_id is not null
        and participation_id is not null
        and payout_id is null
      when 'REFUND' then
        wallet_id is not null
        and holding_account_id is not null
        and hold_id is not null
        and session_id is not null
        and participation_id is not null
        and payout_id is null
      when 'RELEASE' then
        wallet_id is not null
        and holding_account_id is not null
        and hold_id is not null
        and session_id is not null
        and participation_id is not null
        and payout_id is not null
      when 'FORFEIT' then
        wallet_id is not null
        and holding_account_id is not null
        and hold_id is not null
        and session_id is not null
        and participation_id is not null
        and payout_id is not null
      when 'PAYOUT' then
        payout_id is not null
        and session_id is not null
        and external_reference is not null
        and wallet_id is null
        and holding_account_id is null
        and hold_id is null
        and participation_id is null
    end
  )
);

comment on table ledger_entries is
  'Append-only record of every money movement. One row per movement, positive amount, direction implied by kind. Never updated or deleted.';

-- Replay protection of last resort. Even if the idempotency middleware is
-- bypassed, a repeated key cannot produce a second entry.
create unique index ledger_entries_idempotency_key_uidx
  on ledger_entries (idempotency_key);

create index ledger_entries_wallet_idx
  on ledger_entries (wallet_id, occurred_at desc)
  where wallet_id is not null;

create index ledger_entries_hold_idx
  on ledger_entries (hold_id)
  where hold_id is not null;

create index ledger_entries_session_idx
  on ledger_entries (session_id)
  where session_id is not null;

create index ledger_entries_payout_idx
  on ledger_entries (payout_id)
  where payout_id is not null;

create index ledger_entries_external_reference_idx
  on ledger_entries (external_reference)
  where external_reference is not null;

-- Append-only, enforced.
create function forbid_ledger_mutation() returns trigger
language plpgsql
as $fn$
begin
  raise exception 'ledger_entries is append-only; % is not permitted', tg_op
    using errcode = '23514',
          hint = 'Correct a mistaken entry by appending a compensating entry.';
end;
$fn$;

create trigger ledger_entries_forbid_row_mutation
  before update or delete on ledger_entries
  for each row execute function forbid_ledger_mutation();

create trigger ledger_entries_forbid_truncate
  before truncate on ledger_entries
  for each statement execute function forbid_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Balance projections
--
-- These are derived state, rebuilt from ledger_entries by trigger. They exist
-- for two reasons: O(1) balance reads, which the 2-second wallet-operation
-- requirement needs, and a real CHECK constraint on the balance, which a view
-- cannot carry. The reconciliation job proves they still match the ledger.
-- ---------------------------------------------------------------------------

create table wallet_balances (
  wallet_id uuid primary key references wallets (wallet_id) on delete restrict,
  available_cents bigint not null default 0,
  entry_count bigint not null default 0,
  updated_at timestamptz not null default now(),

  -- SRS safety requirement: a lock, release or forfeiture must never drive a
  -- wallet negative. Under READ COMMITTED a concurrent
  -- "SET available_cents = available_cents - n" re-reads the committed row
  -- after waiting on its row lock, so this holds under contention.
  constraint wallet_balances_never_negative
    check (available_cents >= 0)
);

comment on table wallet_balances is
  'Trigger-maintained projection of the WALLET legs of ledger_entries. Never written directly by application code.';

-- REQ-5: a new wallet starts at SGD 0.00.
create function create_wallet_balance() returns trigger
language plpgsql
as $fn$
begin
  insert into wallet_balances (wallet_id) values (new.wallet_id);
  return new;
end;
$fn$;

create trigger wallets_create_balance
  after insert on wallets
  for each row execute function create_wallet_balance();

create table hold_balances (
  hold_id uuid primary key,
  holding_account_id uuid not null references holding_accounts (account_id) on delete restrict,
  wallet_id uuid not null references wallets (wallet_id) on delete restrict,
  session_id uuid not null,
  participation_id uuid not null,
  original_cents bigint not null,
  held_cents bigint not null,
  settled_kind ledger_kind,
  created_at timestamptz not null default now(),
  settled_at timestamptz,

  constraint hold_balances_original_positive
    check (original_cents > 0),

  constraint hold_balances_never_negative
    check (held_cents >= 0),

  constraint hold_balances_never_exceeds_original
    check (held_cents <= original_cents),

  -- A hold is all-or-nothing: either fully held, or fully settled to zero by
  -- exactly one of release, refund or forfeiture. There is no partial
  -- settlement in the model, so the database refuses to represent one.
  constraint hold_balances_settled_all_or_nothing check (
    (settled_kind is null and settled_at is null and held_cents = original_cents)
    or
    (settled_kind is not null and settled_at is not null and held_cents = 0)
  ),

  constraint hold_balances_settlement_kind check (
    settled_kind is null or settled_kind in ('RELEASE', 'REFUND', 'FORFEIT')
  )
);

comment on table hold_balances is
  'One row per FundHold, created by its LOCK entry and zeroed by its settling entry. Mirrors FundHold in domain/sessions/fund-hold.ts, holding only the amounts; the hold state machine itself belongs to the Session aggregate.';

create index hold_balances_session_idx on hold_balances (session_id);
create index hold_balances_wallet_idx on hold_balances (wallet_id);
create index hold_balances_open_idx on hold_balances (session_id) where settled_kind is null;

create table payout_payables (
  payout_id uuid primary key,
  session_id uuid not null,
  payable_cents bigint not null default 0,
  paid_out_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payout_payables_never_negative
    check (payable_cents >= 0),

  constraint payout_payables_paid_out_non_negative
    check (paid_out_cents >= 0)
);

comment on table payout_payables is
  'Amount owed to a booker for one payout attempt: credited by RELEASE and FORFEIT, debited by PAYOUT. Stops the system paying out more than it settled.';

create index payout_payables_session_idx on payout_payables (session_id);

-- ---------------------------------------------------------------------------
-- The five money operations, applied as one trigger
--
--   TOP_UP    external  -> wallet
--   LOCK      wallet    -> holding
--   REFUND    holding   -> wallet
--   RELEASE   holding   -> payable   (booker is owed)
--   FORFEIT   holding   -> payable   (same movement, different reason)
--   PAYOUT    payable   -> external
--
-- Applying them here rather than in application code means the projections
-- cannot drift no matter which client writes the entry.
-- ---------------------------------------------------------------------------

create function apply_ledger_entry() returns trigger
language plpgsql
as $fn$
begin
  -- A simple CASE with no ELSE raises CASE_NOT_FOUND on an unhandled kind,
  -- which is the behaviour we want if someone adds an enum value and forgets
  -- to extend this function.
  case new.kind

    when 'TOP_UP' then
      update wallet_balances
         set available_cents = available_cents + new.amount_cents,
             entry_count = entry_count + 1,
             updated_at = now()
       where wallet_id = new.wallet_id;
      if not found then
        raise exception 'TOP_UP names unknown wallet %', new.wallet_id
          using errcode = '23503';
      end if;

    when 'LOCK' then
      update wallet_balances
         set available_cents = available_cents - new.amount_cents,
             entry_count = entry_count + 1,
             updated_at = now()
       where wallet_id = new.wallet_id;
      if not found then
        raise exception 'LOCK names unknown wallet %', new.wallet_id
          using errcode = '23503';
      end if;

      -- The primary key rejects a second LOCK against the same hold.
      insert into hold_balances (
        hold_id, holding_account_id, wallet_id, session_id, participation_id,
        original_cents, held_cents, created_at
      ) values (
        new.hold_id, new.holding_account_id, new.wallet_id, new.session_id,
        new.participation_id, new.amount_cents, new.amount_cents, new.occurred_at
      );

    when 'REFUND' then
      update hold_balances
         set held_cents = 0,
             settled_kind = 'REFUND',
             settled_at = new.occurred_at
       where hold_id = new.hold_id
         and settled_kind is null
         and held_cents = new.amount_cents;
      if not found then
        raise exception
          'REFUND of % cents does not match an open hold %',
          new.amount_cents, new.hold_id
          using errcode = '23514';
      end if;

      update wallet_balances
         set available_cents = available_cents + new.amount_cents,
             entry_count = entry_count + 1,
             updated_at = now()
       where wallet_id = new.wallet_id;
      if not found then
        raise exception 'REFUND names unknown wallet %', new.wallet_id
          using errcode = '23503';
      end if;

    when 'RELEASE', 'FORFEIT' then
      update hold_balances
         set held_cents = 0,
             settled_kind = new.kind,
             settled_at = new.occurred_at
       where hold_id = new.hold_id
         and settled_kind is null
         and held_cents = new.amount_cents;
      if not found then
        raise exception
          '% of % cents does not match an open hold %',
          new.kind, new.amount_cents, new.hold_id
          using errcode = '23514';
      end if;

      insert into payout_payables (payout_id, session_id, payable_cents)
      values (new.payout_id, new.session_id, new.amount_cents)
      on conflict (payout_id) do update
         set payable_cents = payout_payables.payable_cents + excluded.payable_cents,
             updated_at = now();

    when 'PAYOUT' then
      update payout_payables
         set payable_cents = payable_cents - new.amount_cents,
             paid_out_cents = paid_out_cents + new.amount_cents,
             updated_at = now()
       where payout_id = new.payout_id;
      if not found then
        raise exception 'PAYOUT names unknown payout %', new.payout_id
          using errcode = '23503';
      end if;

  end case;

  return null;
end;
$fn$;

create trigger ledger_entries_apply
  after insert on ledger_entries
  for each row execute function apply_ledger_entry();

-- ---------------------------------------------------------------------------
-- Double-entry expansion
--
-- Each stored row becomes its two signed legs. Every entry's legs sum to zero,
-- so the whole ledger sums to zero. Reconciliation is then a handful of
-- aggregate comparisons rather than a per-operation audit.
-- ---------------------------------------------------------------------------

create view ledger_postings as
  select
    entry_id,
    kind,
    occurred_at,
    'WALLET'::ledger_account_type as account_type,
    wallet_id::text as account_key,
    case kind when 'LOCK' then -amount_cents else amount_cents end as signed_cents
  from ledger_entries
  where kind in ('TOP_UP', 'REFUND', 'LOCK')

  union all

  select
    entry_id,
    kind,
    occurred_at,
    'HOLDING'::ledger_account_type,
    hold_id::text,
    case kind when 'LOCK' then amount_cents else -amount_cents end
  from ledger_entries
  where kind in ('LOCK', 'REFUND', 'RELEASE', 'FORFEIT')

  union all

  select
    entry_id,
    kind,
    occurred_at,
    'PAYABLE'::ledger_account_type,
    payout_id::text,
    case kind when 'PAYOUT' then -amount_cents else amount_cents end
  from ledger_entries
  where kind in ('RELEASE', 'FORFEIT', 'PAYOUT')

  union all

  select
    entry_id,
    kind,
    occurred_at,
    'EXTERNAL'::ledger_account_type,
    'PROVIDER',
    case kind when 'TOP_UP' then -amount_cents else amount_cents end
  from ledger_entries
  where kind in ('TOP_UP', 'PAYOUT');

comment on view ledger_postings is
  'Signed double-entry legs derived from ledger_entries. TOP_UP: external to wallet. LOCK: wallet to holding. REFUND: holding to wallet. RELEASE and FORFEIT: holding to payable. PAYOUT: payable to external.';

-- Balances recomputed from the ledger itself. These are the reference the
-- projections above are checked against, and are never read on the hot path.
create view ledger_wallet_balances as
  select
    w.wallet_id,
    coalesce(sum(p.signed_cents), 0)::bigint as available_cents
  from wallets w
  left join ledger_postings p
    on p.account_type = 'WALLET' and p.account_key = w.wallet_id::text
  group by w.wallet_id;

create view ledger_hold_balances as
  select
    p.account_key::uuid as hold_id,
    sum(p.signed_cents)::bigint as held_cents
  from ledger_postings p
  where p.account_type = 'HOLDING'
  group by p.account_key;

create view ledger_payable_balances as
  select
    p.account_key::uuid as payout_id,
    sum(p.signed_cents)::bigint as payable_cents
  from ledger_postings p
  where p.account_type = 'PAYABLE'
  group by p.account_key;

-- Read by LedgerReadPort.getHoldingAccountBalance().
create view holding_account_balances as
  select
    a.account_id,
    coalesce(sum(h.held_cents), 0)::bigint as held_cents
  from holding_accounts a
  left join hold_balances h on h.holding_account_id = a.account_id
  group by a.account_id;

-- Supports the SRS invariant that a session's locked funds equal the sum of
-- its committed participants' shares. This view supplies the ledger half; the
-- roster half arrives when the participations table is created.
create view session_held_totals as
  select
    session_id,
    count(*) filter (where settled_kind is null) as open_holds,
    coalesce(sum(held_cents), 0)::bigint as held_cents,
    coalesce(sum(original_cents), 0)::bigint as originally_held_cents
  from hold_balances
  group by session_id;

commit;
