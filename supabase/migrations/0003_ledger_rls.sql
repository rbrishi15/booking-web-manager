-- 0003_ledger_rls.sql
--
-- Row level security and privileges for the wallet ledger.
-- Owner: Harrison (harr008).
--
-- Access control design
--   Nobody writes finance tables over the Data API. Every money movement goes
--   through a server route using the service role, which is what keeps
--   balances, refund amounts and settlement outcomes computed server-side as
--   the SRS security requirements demand.
--   A signed-in user may read their own wallet, its balance and its transaction
--   history, and nothing else. Holds, payables, provider snapshots,
--   reconciliation runs and idempotency records are invisible to the Data API.
--
-- Traceability
--   SRS 7.2 security requirements  server-side computation, least privilege
--   REQ-7                          a user can read their own transaction history

begin;

-- The Supabase API roles. Created if absent so this migration also applies to a
-- plain Postgres instance, which the DB-backed tests use.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$roles$;

-- Equivalent of auth.uid(), defined locally so the policies below do not depend
-- on the auth schema existing. Returns null when there is no JWT, which makes
-- every policy fail closed.
create function public.ledger_current_user_id()
returns uuid
language sql
stable
as $fn$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$fn$;

comment on function public.ledger_current_user_id() is
  'The authenticated user ID from the request JWT, or null. Null makes every ledger policy deny.';

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere in this subsystem
--
-- Enabling without a policy denies by default, which is what the internal
-- tables want. The table owner and the service role still reach them, so
-- migrations, the reconciliation job and server routes are unaffected.
-- ---------------------------------------------------------------------------

alter table wallets enable row level security;
alter table wallet_balances enable row level security;
alter table ledger_entries enable row level security;
alter table hold_balances enable row level security;
alter table holding_accounts enable row level security;
alter table payout_payables enable row level security;
alter table idempotency_keys enable row level security;
alter table processed_events enable row level security;
alter table provider_balance_snapshots enable row level security;
alter table reconciliation_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Read policies: a user sees their own money and nothing else
-- ---------------------------------------------------------------------------

create policy wallets_select_own
  on wallets
  for select
  to authenticated
  using (user_id = public.ledger_current_user_id());

create policy wallet_balances_select_own
  on wallet_balances
  for select
  to authenticated
  using (
    exists (
      select 1
        from wallets w
       where w.wallet_id = wallet_balances.wallet_id
         and w.user_id = public.ledger_current_user_id()
    )
  );

-- REQ-7. Settlement entries for a participant's own hold are visible to that
-- participant, since wallet_id carries the origin wallet on every kind that
-- names one. PAYOUT entries name no wallet and stay invisible.
create policy ledger_entries_select_own
  on ledger_entries
  for select
  to authenticated
  using (
    wallet_id is not null
    and exists (
      select 1
        from wallets w
       where w.wallet_id = ledger_entries.wallet_id
         and w.user_id = public.ledger_current_user_id()
    )
  );

-- No INSERT, UPDATE or DELETE policy is defined for any finance table. Writes
-- reach these tables only through the service role.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Supabase grants all privileges on new public tables to anon and authenticated
-- by default. Take that back for every table in this subsystem before granting
-- the three narrow reads.
revoke all on table
  wallets,
  wallet_balances,
  ledger_entries,
  hold_balances,
  holding_accounts,
  payout_payables,
  idempotency_keys,
  processed_events,
  provider_balance_snapshots,
  reconciliation_runs
from anon, authenticated;

grant select on table wallets, wallet_balances, ledger_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Views
--
-- A view runs with its owner's privileges unless told otherwise, which would
-- let it read straight past the policies above. security_invoker makes each
-- view apply the caller's own permissions and policies instead.
-- ---------------------------------------------------------------------------

alter view ledger_postings set (security_invoker = on);
alter view ledger_wallet_balances set (security_invoker = on);
alter view ledger_hold_balances set (security_invoker = on);
alter view ledger_payable_balances set (security_invoker = on);
alter view holding_account_balances set (security_invoker = on);
alter view session_held_totals set (security_invoker = on);

revoke all on table
  ledger_postings,
  ledger_wallet_balances,
  ledger_hold_balances,
  ledger_payable_balances,
  holding_account_balances,
  session_held_totals
from anon, authenticated;

-- Reconciliation and its helper are server-side only.
revoke all on function reconcile_ledger() from anon, authenticated;
revoke all on function run_reconciliation() from anon, authenticated;

commit;
