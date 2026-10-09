import type { UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { text } from "@/lib/sessions/postgres-row-values";
import type { DueSessionQuery } from "@/use-cases/sessions/scheduling-ports";

const AUTO_VERIFY_AFTER_END_MS = 72 * 3_600_000;

/**
 * Finds open sessions with scheduled commitment work (UC2-05, UC2-06):
 *
 * - started, with a late withdrawal still awaiting replacement (forfeiture);
 * - not started, with a free place and a queue head promotion can act on
 *   (promotion);
 * - ended at least 72 hours ago (automatic verification).
 *
 * Promotion eligibility mirrors the domain so a session that cannot make
 * progress is never selected: free places are total slots minus committed
 * participants minus pending personal-invitation reservations
 * (`Session.getAvailableSlots`), and a queue head who is the invitee of such a
 * reservation stops promotion (`PromoteFromWaitlist`). Every other outcome
 * changes the session (a promoted or skipped head leaves the queue; expiry and
 * verification leave this query), so unchanged sessions cannot fill a batch
 * and starve later ones. Each job still re-checks its own rule under the
 * session lock.
 *
 * This is one autocommit read, so it takes no row locks; concurrent sweeps
 * may pick the same session and each job's unit of work serializes them.
 * Earliest sessions come first.
 */
export class PostgresDueSessionQuery implements DueSessionQuery {
  constructor(private readonly sql: SqlExecutor) {}

  async dueSessionIds(now: Date, limit: number): Promise<readonly UUID[]> {
    const rows = await this.sql.query(
      `with reservations as (
         -- Personal-invitation places held for a named invitee
         -- (personalReplacementReservations in the domain).
         select p.session_id, p.replacement_invitee_id as invitee_id
         from participations p
         join fund_holds h on h.participation_id = p.participation_id
         where p.status = 'WITHDRAWN'
           and p.replacement_mode = 'DIRECT_INVITE'
           and h.state in ('AWAITING_REPLACEMENT', 'REFUNDED')
           and not exists (
             select 1 from participations r
             where r.replaces_participation_id = p.participation_id
           )
       )
       select s.session_id
       from sessions s
       where s.status = 'OPEN'
         and (
           (s.start_at <= $1 and exists (
             select 1
             from participations p
             join fund_holds h on h.participation_id = p.participation_id
             where p.session_id = s.session_id
               and h.state = 'AWAITING_REPLACEMENT'
           ))
           or (s.start_at > $1
             and (
               select count(*) from participations p
               where p.session_id = s.session_id and p.status = 'COMMITTED'
             ) + (
               select count(*) from reservations r where r.session_id = s.session_id
             ) < s.total_slots
             and exists (
               select 1
               from participations head
               where head.session_id = s.session_id
                 and head.status = 'WAITLISTED'
                 and head.queue_sequence = (
                   select min(w.queue_sequence) from participations w
                   where w.session_id = s.session_id and w.status = 'WAITLISTED'
                 )
                 and not exists (
                   select 1 from reservations r
                   where r.session_id = s.session_id and r.invitee_id = head.user_id
                 )
             ))
           or s.end_at <= $2
         )
       order by s.start_at asc, s.session_id asc
       limit $3`,
      [now, new Date(now.getTime() - AUTO_VERIFY_AFTER_END_MS), limit],
    );
    return rows.map((row) => text(row.session_id));
  }
}
