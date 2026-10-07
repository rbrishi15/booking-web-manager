import type { UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { text } from "@/lib/sessions/postgres-row-values";
import type { DueSessionQuery } from "@/use-cases/sessions/scheduling-ports";

const AUTO_VERIFY_AFTER_END_MS = 72 * 3_600_000;

/**
 * Finds open sessions with scheduled commitment work (UC2-05, UC2-06):
 *
 * - started, with a late withdrawal still awaiting replacement (forfeiture);
 * - not started, with people waiting and fewer commitments than places
 *   (promotion; a pending named invitation may still hold the place);
 * - ended at least 72 hours ago (automatic verification).
 *
 * The conditions are deliberately tight so a quiet session is not revisited
 * every run, but every job still re-checks its own rule under the session
 * lock. This is one autocommit read, so it takes no row locks; concurrent
 * sweeps may pick the same session and each job's unit of work serializes
 * them. Earliest sessions come first.
 */
export class PostgresDueSessionQuery implements DueSessionQuery {
  constructor(private readonly sql: SqlExecutor) {}

  async dueSessionIds(now: Date, limit: number): Promise<readonly UUID[]> {
    const rows = await this.sql.query(
      `select s.session_id
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
             and exists (
               select 1 from participations p
               where p.session_id = s.session_id and p.status = 'WAITLISTED'
             )
             and (
               select count(*) from participations p
               where p.session_id = s.session_id and p.status = 'COMMITTED'
             ) < s.total_slots)
           or s.end_at <= $2
         )
       order by s.start_at asc, s.session_id asc
       limit $3`,
      [now, new Date(now.getTime() - AUTO_VERIFY_AFTER_END_MS), limit],
    );
    return rows.map((row) => text(row.session_id));
  }
}
