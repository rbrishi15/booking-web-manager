import type { SqlExecutor } from "@/lib/money/sql";
import type {
  UpcomingBooking,
  UpcomingBookingsQuery,
  UpcomingBookingsReader,
} from "@/use-cases/sessions/ListUpcomingBookings";
import { date, text } from "./postgres-row-values";

/** Checks the caller's enrollment without hydrating a roster or reading money. */
export class PostgresUpcomingBookingsReader implements UpcomingBookingsReader {
  constructor(private readonly sql: SqlExecutor) {}

  async list(input: UpcomingBookingsQuery): Promise<readonly UpcomingBooking[]> {
    const rows = await this.sql.query(
      `select s.session_id, s.venue_name, s.sport, s.region, s.start_at, s.end_at
       from sessions s
       where s.status = 'OPEN' and s.start_at > $2
         and (s.booker_id = $1 or exists (
           select 1 from participations p
           where p.session_id = s.session_id and p.user_id = $1
             and p.status = 'COMMITTED'
         ))
       order by s.start_at asc, s.session_id asc
       limit $3`,
      [input.userId, input.now, input.limit],
    );
    return rows.map((row) => ({
      sessionId: text(row.session_id),
      venueName: text(row.venue_name),
      sport: text(row.sport),
      region: text(row.region),
      startAt: date(row.start_at),
      endAt: date(row.end_at),
    }));
  }
}
