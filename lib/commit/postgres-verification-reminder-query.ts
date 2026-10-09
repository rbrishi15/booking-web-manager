import type { UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { text } from "@/lib/sessions/postgres-row-values";
import type {
  VerificationReminder,
  VerificationReminderQuery,
} from "@/use-cases/sessions/scheduling-ports";

/**
 * Claims and releases UC2-06 "verify attendance" reminders through
 * `sessions.verification_reminded_at` (migration 0009).
 *
 * A session is due once it has ended, is still OPEN, has a committed
 * participant whose attendance is unverified, and has not been reminded.
 * The claim marks and returns those sessions in one UPDATE; `SKIP LOCKED`
 * leaves sessions another transaction holds (for example a booker verifying
 * right now) for a later sweep, and concurrent sweeps never claim the same
 * reminder twice.
 */
export class PostgresVerificationReminderQuery implements VerificationReminderQuery {
  constructor(private readonly sql: SqlExecutor) {}

  async claimVerificationReminders(
    now: Date,
    limit: number,
  ): Promise<readonly VerificationReminder[]> {
    const rows = await this.sql.query(
      `update sessions s
       set verification_reminded_at = $1
       where s.session_id in (
         select d.session_id
         from sessions d
         where d.status = 'OPEN'
           and d.verification_reminded_at is null
           and d.end_at <= $1
           and exists (
             select 1 from participations p
             where p.session_id = d.session_id
               and p.status = 'COMMITTED' and p.attendance = 'UNVERIFIED'
           )
         order by d.end_at asc, d.session_id asc
         limit $2
         for update skip locked
       )
       returning s.session_id, s.booker_id`,
      [now, limit],
    );
    return rows.map((row) => ({
      sessionId: text(row.session_id),
      bookerId: text(row.booker_id),
    }));
  }

  async releaseVerificationReminders(sessionIds: readonly UUID[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.sql.query(
      `update sessions set verification_reminded_at = null
       where session_id = any($1::uuid[])`,
      [[...sessionIds]],
    );
  }
}
