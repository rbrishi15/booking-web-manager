-- UC2-02: session capacity is the sole participant-count configuration.
begin;
-- Rollback consideration: dropping minimum_headcount discards its per-session values.
-- If the column is re-added, restore those values from a pre-migration backup.
alter table sessions drop column minimum_headcount;
alter table sessions drop constraint sessions_total_slots_check;
alter table sessions add constraint sessions_total_slots_check check (total_slots between 2 and 8);
commit;
