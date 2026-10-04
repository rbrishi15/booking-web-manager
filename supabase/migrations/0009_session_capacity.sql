-- UC2-02: session capacity is the sole participant-count configuration.
begin;
-- Dropped minimum_headcount values are discarded; rollback requires restoring them from a backup.
alter table sessions drop column minimum_headcount;
alter table sessions drop constraint sessions_total_slots_check;
alter table sessions add constraint sessions_total_slots_check check (total_slots between 2 and 8);
commit;
