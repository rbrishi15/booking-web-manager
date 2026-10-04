-- UC2-02: preserve existing quoted shares and permit bounded booker pricing.
-- Apply before deploying clients that supply pricePerSlotCents.
-- Rollback is unsupported once custom prices differ from total_cost_cents / total_slots:
-- restoring sessions_calculated_share would reject those existing sessions.
begin;
alter table sessions drop constraint sessions_calculated_share;
alter table sessions add constraint sessions_price_within_range check (
  total_cost_cents / total_slots > 0
  and booking_share_cents >= greatest(1, ((total_cost_cents / total_slots) + 1) / 2)
  and booking_share_cents <= least(
    (total_cost_cents / total_slots) * 2,
    9007199254740991::bigint / total_slots
  )
);
commit;
