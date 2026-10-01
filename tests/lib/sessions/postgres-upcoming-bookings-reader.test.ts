import { expect, test, vi } from "vitest";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresUpcomingBookingsReader } from "@/lib/sessions/postgres-upcoming-bookings-reader";

function scenario() {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([]);
  return { query, reader: new PostgresUpcomingBookingsReader({ query: query as SqlExecutor["query"] }) };
}

test("binds the identity, current time, and limit without accessing private payment data", async () => {
  const { query, reader } = scenario();
  const userId = "' OR true --";
  const now = new Date("2040-01-01T00:00:00Z");
  await reader.list({ userId, now, limit: 20 });

  const [statement, parameters] = query.mock.calls[0] ?? [];
  expect(statement).not.toContain(userId);
  expect(statement).not.toMatch(/ledger|fund_holds|room_token|wallet|select\s+\*/);
  expect(parameters).toEqual([userId, now, 20]);
});

test("only exposes personal booking summary fields even if the database returns additional columns", async () => {
  const { query, reader } = scenario();
  const startAt = new Date("2040-01-02T00:00:00Z");
  const endAt = new Date("2040-01-02T01:00:00Z");
  query.mockResolvedValue([{
    session_id: "10000000-0000-4000-8000-000000000001",
    venue_name: "Sports hall", sport: "Badminton", region: "West",
    start_at: startAt, end_at: endAt, room_token: "secret", booker_id: "other-user",
  }]);

  expect(await reader.list({ userId: "user", now: new Date(), limit: 20 })).toEqual([{
    sessionId: "10000000-0000-4000-8000-000000000001",
    venueName: "Sports hall", sport: "Badminton", region: "West", startAt, endAt,
  }]);
});
