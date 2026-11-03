-- UC2-05: a late withdrawal may forfeit its share and close the place (ADR-0024).
-- FORFEIT participations are WITHDRAWN with a FORFEITURE_DUE hold from the
-- moment of withdrawal; settlement later forfeits that hold to the booker as it
-- already does for an unmatched late withdrawal. No existing row changes.
begin;
alter table participations drop constraint participations_replacement_mode_check;
alter table participations add constraint participations_replacement_mode_check
  check (replacement_mode in ('OPEN_SLOT', 'DIRECT_INVITE', 'FORFEIT'));
commit;

-- Rollback, only while no participation uses FORFEIT:
--   alter table participations drop constraint participations_replacement_mode_check,
--     add constraint participations_replacement_mode_check
--     check (replacement_mode in ('OPEN_SLOT', 'DIRECT_INVITE'));
