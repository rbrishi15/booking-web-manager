-- UC2-03a: complete Session hydration for owner management.
-- Creation is the only earlier application writer. Unknown lifecycle history
-- or participant-list order cannot be reconstructed from the previous schema.
begin;

-- Hold these locks through preflight and ALTER: a concurrent session/participant
-- insert must not slip between the legacy-data check and the new defaults.
-- Parent first, then child, matching the lifecycle aggregate lock order.
lock table sessions, participations in access exclusive mode;

do $migration$
begin
  if exists (select 1 from participations)
     or exists (select 1 from sessions where status <> 'OPEN') then
    raise exception '0007_session_management requires verified backfill for existing participation or lifecycle data';
  end if;
end;
$migration$;

alter table sessions
  add column payout_attempt_ids uuid[] not null default '{}',
  add column payout_idempotency_keys text[] not null default '{}',
  add column pending_settlement jsonb;

alter table sessions add constraint sessions_pending_settlement_object
  check (pending_settlement is null or jsonb_typeof(pending_settlement) = 'object');

-- A durable insertion position preserves domain participant-list order, including ties
-- in withdrawal times. It is independent of the waitlist queue sequence.
alter table participations
  add column list_position bigint generated always as identity,
  add constraint participations_session_list_position unique (session_id, list_position);

commit;

-- Manual rollback: unsafe once lifecycle writers have populated these fields.
-- Stop those writers and verify that no lifecycle data depends on this migration
-- before executing the following statements in a transaction:
-- begin;
-- alter table participations
--   drop constraint participations_session_list_position,
--   drop column list_position;
-- alter table sessions
--   drop constraint sessions_pending_settlement_object,
--   drop column payout_attempt_ids,
--   drop column payout_idempotency_keys,
--   drop column pending_settlement;
-- commit;
