import { z } from "zod";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor } from "@/lib/money/sql";
import type {
  DiscoveredSession,
  SessionDiscoveryCriteria,
} from "@/use-cases/sessions/DiscoverSessions";
import type { SessionDiscoveryReader } from "@/use-cases/sessions/session-discovery-transaction";
import { date, text } from "./postgres-row-values";

/** A single read query over the public summary; no roster or ledger joins. */
export class PostgresSessionDiscoveryReader implements SessionDiscoveryReader {
  constructor(private readonly sql: SqlExecutor) {}

  async search(criteria: SessionDiscoveryCriteria, now: Date): Promise<readonly DiscoveredSession[]> {
    const values: unknown[] = [now];
    const conditions = ["visibility = 'PUBLIC'", "status = 'OPEN'", "start_at > $1"];
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (criteria.text !== undefined) {
      // SQL LIKE treats these as syntax; user search text must remain literal.
      const pattern = parameter(`%${criteria.text.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(`(sport ilike ${pattern} or venue_name ilike ${pattern})`);
    }
    if (criteria.sport !== undefined) conditions.push(`sport = ${parameter(criteria.sport)}`);
    if (criteria.region !== undefined) conditions.push(`region = ${parameter(criteria.region)}`);
    if (criteria.startsWithin?.from !== undefined)
      conditions.push(`start_at >= ${parameter(criteria.startsWithin.from)}`);
    if (criteria.startsWithin?.before !== undefined)
      conditions.push(`start_at < ${parameter(criteria.startsWithin.before)}`);
    const rows = await this.sql.query(
      `select session_id, venue_name, sport, region, start_at, end_at,
              total_slots, booking_share_cents
       from sessions
       where ${conditions.join(" and ")}
       order by start_at asc, session_id asc`,
      values,
    );
    return rows.map((row) => ({
      sessionId: text(row.session_id),
      venueName: text(row.venue_name),
      sport: text(row.sport),
      region: text(row.region),
      startAt: date(row.start_at),
      endAt: date(row.end_at),
      totalSlots: z.number().int().min(1).max(8).parse(row.total_slots),
      bookingShareCents: fromDatabaseCents(row.booking_share_cents, "booking_share_cents").toCents(),
    }));
  }
}
