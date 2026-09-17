-- 0002_idempotency_and_reconciliation.sql
--
-- Idempotency keys, provider event de-duplication, and the hourly
-- reconciliation job.
-- Owner: Harrison (harr008).
--
-- Seam with the payments role
--   Reconciliation has to compare what the ledger believes against what the
--   payment provider actually holds, but CLAUDE.md rule 3 says only the
--   repository owner calls the Stripe SDK. So this migration does not reach
--   out to Stripe. It reads provider_balance_snapshots, a table the webhook and
--   payout handlers in /app/api/webhooks and /app/payouts write. If no snapshot
--   has ever been recorded, the provider check reports that it could not run
--   rather than silently passing.
--
-- Traceability
--   SRS 7.1 safety requirements   every wallet-mutating request carries a unique
--                                 idempotency key; a repeat key returns the
--                                 original result without re-executing
--   SRS 2.4 operating environment  observability is the reconciliation job only

begin;

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

create table idempotency_keys (
  idempotency_key text primary key,
  scope text not null,

  -- Hash of the caller's request. A second call presenting the same key but a
  -- different body is a client bug, not a retry, and is rejected rather than
  -- being served the earlier response.
  request_fingerprint text not null,

  status idempotency_status not null default 'IN_PROGRESS',
  response jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint idempotency_keys_key_not_blank
    check (btrim(idempotency_key) <> ''),

  constraint idempotency_keys_scope_not_blank
    check (btrim(scope) <> ''),

  constraint idempotency_keys_terminal_state check (
    (status = 'IN_PROGRESS' and completed_at is null)
    or
    (status in ('SUCCEEDED', 'FAILED') and completed_at is not null)
  ),

  constraint idempotency_keys_success_has_response check (
    status <> 'SUCCEEDED' or response is not null
  )
);

comment on table idempotency_keys is
  'One row per wallet-mutating request. Claimed before the work runs and completed inside the same transaction, so a replay either returns the stored response or waits on the in-flight row.';

create index idempotency_keys_created_at_idx on idempotency_keys (created_at);
create index idempotency_keys_in_progress_idx on idempotency_keys (created_at)
  where status = 'IN_PROGRESS';

-- ---------------------------------------------------------------------------
-- Provider event de-duplication
--
-- Written by the webhook handler, which is the sole writer for inbound money
-- (CLAUDE.md rule 2). The table lives here because it is ledger schema; the
-- handler that uses it is owned by the payments role.
-- ---------------------------------------------------------------------------

create table processed_events (
  event_id text primary key,
  provider text not null default 'stripe',
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  ledger_entry_id uuid references ledger_entries (entry_id) on delete restrict,

  constraint processed_events_event_id_not_blank
    check (btrim(event_id) <> '')
);

comment on table processed_events is
  'Provider event IDs already handled. A replayed webhook finds its ID here and is acknowledged without crediting a second time.';

create index processed_events_received_at_idx on processed_events (received_at);

-- ---------------------------------------------------------------------------
-- Provider balance snapshots
-- ---------------------------------------------------------------------------

create table provider_balance_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  provider text not null default 'stripe',
  currency text not null default 'SGD',

  -- Cumulative totals since the account opened, all non-negative.
  gross_received_cents bigint not null,
  fees_cents bigint not null,
  payouts_paid_cents bigint not null,

  fees_borne_by fee_policy not null default 'PLATFORM_ABSORBS',
  source_reference text,

  constraint provider_balance_snapshots_currency_is_sgd
    check (currency = 'SGD'),
  constraint provider_balance_snapshots_gross_non_negative
    check (gross_received_cents >= 0),
  constraint provider_balance_snapshots_fees_non_negative
    check (fees_cents >= 0),
  constraint provider_balance_snapshots_payouts_non_negative
    check (payouts_paid_cents >= 0)
);

comment on table provider_balance_snapshots is
  'Periodic record of the payment provider position, written by the payments role. Reconciliation reads the most recent row; nothing here calls Stripe.';

create index provider_balance_snapshots_captured_at_idx
  on provider_balance_snapshots (captured_at desc);

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------

create table reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  passed boolean not null,
  checks jsonb not null
);

comment on table reconciliation_runs is
  'Result of each reconciliation pass. Retained as the audit trail for financial integrity; the run is recorded whether or not it passed.';

create index reconciliation_runs_ran_at_idx on reconciliation_runs (ran_at desc);
create index reconciliation_runs_failures_idx on reconciliation_runs (ran_at desc)
  where not passed;

-- Runs every integrity check and reports one row per check. Pure read: it
-- never repairs anything, because a ledger that silently repairs itself cannot
-- be audited.
create function reconcile_ledger()
returns table (check_name text, passed boolean, detail jsonb)
language plpgsql
stable
as $fn$
declare
  v_snapshot provider_balance_snapshots%rowtype;
  v_has_snapshot boolean;
  v_net_cents bigint;
  v_internal_cents bigint;
  v_expected_cents bigint;
  v_paid_out_cents bigint;
begin
  select * into v_snapshot
    from provider_balance_snapshots
   order by captured_at desc
   limit 1;
  v_has_snapshot := found;

  -- 1. Every entry's two legs cancel. A failure here means the posting
  --    expansion and the stored kinds have diverged.
  return query
  select
    'entry_legs_balance'::text,
    count(*) = 0,
    jsonb_build_object(
      'unbalanced_entry_ids',
      coalesce(jsonb_agg(u.entry_id), '[]'::jsonb)
    )
  from (
    select entry_id
      from ledger_postings
     group by entry_id
    having sum(signed_cents) <> 0
  ) u;

  -- 2. The ledger as a whole conserves money.
  select coalesce(sum(signed_cents), 0) into v_net_cents from ledger_postings;
  return query
  select
    'ledger_conserves'::text,
    v_net_cents = 0,
    jsonb_build_object('net_cents', v_net_cents);

  -- 3. The wallet projection still equals what the ledger says.
  return query
  select
    'wallet_projection_matches_ledger'::text,
    count(*) = 0,
    jsonb_build_object(
      'mismatches',
      coalesce(jsonb_agg(jsonb_build_object(
        'wallet_id', d.wallet_id,
        'projection_cents', d.projection_cents,
        'ledger_cents', d.ledger_cents
      )), '[]'::jsonb)
    )
  from (
    select
      b.wallet_id,
      b.available_cents as projection_cents,
      l.available_cents as ledger_cents
    from wallet_balances b
    join ledger_wallet_balances l on l.wallet_id = b.wallet_id
    where b.available_cents <> l.available_cents
  ) d;

  -- 4. The hold projection still equals what the ledger says, including holds
  --    present on only one side.
  return query
  select
    'hold_projection_matches_ledger'::text,
    count(*) = 0,
    jsonb_build_object(
      'mismatches',
      coalesce(jsonb_agg(jsonb_build_object(
        'hold_id', d.hold_id,
        'projection_cents', d.projection_cents,
        'ledger_cents', d.ledger_cents
      )), '[]'::jsonb)
    )
  from (
    select
      coalesce(h.hold_id, l.hold_id) as hold_id,
      h.held_cents as projection_cents,
      l.held_cents as ledger_cents
    from hold_balances h
    full join ledger_hold_balances l on l.hold_id = h.hold_id
    where coalesce(h.held_cents, -1) <> coalesce(l.held_cents, -1)
  ) d;

  -- 5. The payable projection still equals what the ledger says.
  return query
  select
    'payable_projection_matches_ledger'::text,
    count(*) = 0,
    jsonb_build_object(
      'mismatches',
      coalesce(jsonb_agg(jsonb_build_object(
        'payout_id', d.payout_id,
        'projection_cents', d.projection_cents,
        'ledger_cents', d.ledger_cents
      )), '[]'::jsonb)
    )
  from (
    select
      coalesce(p.payout_id, l.payout_id) as payout_id,
      p.payable_cents as projection_cents,
      l.payable_cents as ledger_cents
    from payout_payables p
    full join ledger_payable_balances l on l.payout_id = p.payout_id
    where coalesce(p.payable_cents, -1) <> coalesce(l.payable_cents, -1)
  ) d;

  -- 6. No balance is negative. CHECK constraints already guarantee this; the
  --    assertion is here so a dropped constraint shows up as a failed run.
  return query
  select
    'no_negative_balances'::text,
    count(*) = 0,
    jsonb_build_object(
      'negative',
      coalesce(jsonb_agg(jsonb_build_object('account', d.account, 'key', d.key, 'cents', d.cents)), '[]'::jsonb)
    )
  from (
    select 'WALLET' as account, wallet_id::text as key, available_cents as cents
      from wallet_balances where available_cents < 0
    union all
    select 'HOLDING', hold_id::text, held_cents
      from hold_balances where held_cents < 0
    union all
    select 'PAYABLE', payout_id::text, payable_cents
      from payout_payables where payable_cents < 0
  ) d;

  -- 7. Every hold is either fully held or fully settled. A partially settled
  --    hold would mean a release and a refund had both touched it.
  return query
  select
    'holds_settled_all_or_nothing'::text,
    count(*) = 0,
    jsonb_build_object(
      'partial_holds',
      coalesce(jsonb_agg(h.hold_id), '[]'::jsonb)
    )
  from hold_balances h
  where h.held_cents <> 0 and h.held_cents <> h.original_cents;

  -- 8. The provider check. Internal liabilities are what the platform owes its
  --    users: available wallet funds, funds held for sessions, and amounts
  --    settled to bookers but not yet paid out.
  select
    (select coalesce(sum(available_cents), 0) from wallet_balances)
    + (select coalesce(sum(held_cents), 0) from hold_balances)
    + (select coalesce(sum(payable_cents), 0) from payout_payables)
  into v_internal_cents;

  if not v_has_snapshot then
    -- With no provider data the only position that can be confirmed is an
    -- empty ledger. Anything else is unverified, and says so.
    return query
    select
      'provider_balance_reconciles'::text,
      v_internal_cents = 0,
      jsonb_build_object(
        'reason', 'no provider balance snapshot recorded',
        'internal_liabilities_cents', v_internal_cents
      );
  else
    v_expected_cents :=
      v_snapshot.gross_received_cents
      - v_snapshot.payouts_paid_cents
      - case when v_snapshot.fees_borne_by = 'USER_PAYS'
             then v_snapshot.fees_cents
             else 0
        end;

    return query
    select
      'provider_balance_reconciles'::text,
      v_internal_cents = v_expected_cents,
      jsonb_build_object(
        'internal_liabilities_cents', v_internal_cents,
        'expected_cents', v_expected_cents,
        'difference_cents', v_internal_cents - v_expected_cents,
        'snapshot_id', v_snapshot.snapshot_id,
        'snapshot_captured_at', v_snapshot.captured_at,
        'fees_borne_by', v_snapshot.fees_borne_by
      );

    -- 9. What the ledger thinks it paid out matches what the provider reports.
    select coalesce(sum(paid_out_cents), 0) into v_paid_out_cents
      from payout_payables;

    return query
    select
      'payouts_match_provider'::text,
      v_paid_out_cents = v_snapshot.payouts_paid_cents,
      jsonb_build_object(
        'ledger_paid_out_cents', v_paid_out_cents,
        'provider_paid_out_cents', v_snapshot.payouts_paid_cents,
        'difference_cents', v_paid_out_cents - v_snapshot.payouts_paid_cents
      );
  end if;

  return;
end;
$fn$;

comment on function reconcile_ledger() is
  'Runs every financial integrity check and returns one row per check. Read-only: it reports drift, it never repairs it.';

-- Wraps reconcile_ledger() so the outcome is recorded. A failure is raised as
-- a warning rather than an exception, because an exception would roll back the
-- very record of the failure.
create function run_reconciliation()
returns uuid
language plpgsql
as $fn$
declare
  v_run_id uuid;
  v_passed boolean;
  v_checks jsonb;
begin
  select
    coalesce(bool_and(r.passed), true),
    coalesce(jsonb_agg(jsonb_build_object(
      'check', r.check_name,
      'passed', r.passed,
      'detail', r.detail
    ) order by r.check_name), '[]'::jsonb)
  into v_passed, v_checks
  from reconcile_ledger() r;

  insert into reconciliation_runs (passed, checks)
  values (v_passed, v_checks)
  returning run_id into v_run_id;

  if not v_passed then
    raise warning 'Ledger reconciliation % failed: %', v_run_id, v_checks;
  end if;

  return v_run_id;
end;
$fn$;

comment on function run_reconciliation() is
  'Runs reconcile_ledger() and stores the outcome in reconciliation_runs. Scheduled hourly via pg_cron.';

-- Hourly schedule. Guarded because pg_cron is not present on every local
-- Postgres; on those instances the job is run by calling run_reconciliation()
-- directly, which is what the tests do.
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice
      'pg_cron unavailable; schedule run_reconciliation() externally.';
    return;
  end if;

  create extension if not exists pg_cron;

  perform cron.schedule(
    'reconcile-ledger-hourly',
    '0 * * * *',
    'select public.run_reconciliation();'
  );
exception
  -- Scheduling is optional. pg_cron needs shared_preload_libraries and
  -- superuser, neither of which is guaranteed on a local instance, and a
  -- migration that cannot apply is worse than a job that must be scheduled by
  -- hand. The block rolls back to its own savepoint; the migration continues.
  when others then
    raise notice
      'Could not schedule reconciliation (%). Run run_reconciliation() hourly from Vercel Cron or pg_cron instead.',
      sqlerrm;
end;
$cron$;

commit;
