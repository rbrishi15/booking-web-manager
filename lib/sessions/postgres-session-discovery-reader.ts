import { z } from "zod";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor } from "@/lib/money/sql";
import type {
  DiscoveredSession,
  SessionDiscoveryQuery,
  SessionDiscoveryReader,
} from "@/use-cases/sessions/DiscoverSessions";
import { date, text } from "./postgres-row-values";

/** A single read query over the public summary; no roster or ledger joins. */
export class PostgresSessionDiscoveryReader implements SessionDiscoveryReader {
  constructor(private readonly sql: SqlExecutor) {}

  async search(input: SessionDiscoveryQuery): Promise<readonly DiscoveredSession[]> {
    const values: unknown[] = [input.now];
    const conditions = ["visibility = 'PUBLIC'", "status = 'OPEN'", "start_at > $1"];
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (input.sport !== undefined) conditions.push(`sport = ${parameter(input.sport)}`);
    if (input.region !== undefined) conditions.push(`region = ${parameter(input.region)}`);
    if (input.startAtFrom !== undefined)
      conditions.push(`start_at >= ${parameter(input.startAtFrom)}`);
    if (input.startAtBefore !== undefined)
      conditions.push(`start_at < ${parameter(input.startAtBefore)}`);
    if (input.cursor !== undefined) {
      conditions.push(
        `(start_at, session_id) > (${parameter(input.cursor.startAt)}::timestamptz, ${parameter(input.cursor.sessionId)}::uuid)`,
      );
    }
    const limit = parameter(input.limit);
    const rows = await this.sql.query(
      `select session_id, venue_name, sport, region, start_at, end_at,
              total_slots, booking_share_cents
       from sessions
       where ${conditions.join(" and ")}
       order by start_at asc, session_id asc
       limit ${limit}`,
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
