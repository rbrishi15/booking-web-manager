import type { AccountStatus } from "@/domain";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor } from "@/lib/money/sql";
import type { JoinedSession, JoinedSessionsQuery, JoinedSessionsReader } from "@/use-cases/sessions/ListJoinedSessions";
import { choice, date, text } from "./postgres-row-values";

/** Reads the caller's own places without hydrating rosters or reading wallets. */
export class PostgresJoinedSessionsReader implements JoinedSessionsReader {
  constructor(private readonly sql: SqlExecutor) {}

  async accountStatus(userId: string): Promise<AccountStatus | null> {
    const [row] = await this.sql.query("select account_status from profiles where user_id = $1", [userId]);
    return row === undefined ? null : choice(row.account_status, ["ACTIVE", "INACTIVE"] as const);
  }

  async list(query: JoinedSessionsQuery): Promise<readonly JoinedSession[]> {
    const rows = await this.sql.query(
      `select s.session_id, s.venue_name, s.sport, s.region, s.start_at, s.end_at,
              s.booking_share_cents, p.status
       from participations p
       join sessions s on s.session_id = p.session_id
       where p.user_id = $1 and p.status in ('COMMITTED', 'WAITLISTED')
         and s.status = 'OPEN' and s.start_at > $2
       order by s.start_at asc, s.session_id asc`,
      [query.userId, query.now],
    );
    return rows.map((row) => ({
      sessionId: text(row.session_id),
      venueName: text(row.venue_name),
      sport: text(row.sport),
      region: text(row.region),
      startAt: date(row.start_at),
      endAt: date(row.end_at),
      status: choice(row.status, ["COMMITTED", "WAITLISTED"] as const),
      bookingShareCents: fromDatabaseCents(row.booking_share_cents, "booking_share_cents").toCents(),
    }));
  }
}
