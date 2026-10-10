import { expect, test, vi } from "vitest";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresJoinedSessionsReader } from "@/lib/sessions/postgres-joined-sessions-reader";

function scenario() {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([]);
  return { query, reader: new PostgresJoinedSessionsReader({ query: query as SqlExecutor["query"] }) };
}

test("binds the identity and current time without reading rosters, wallets or room tokens", async () => {
  const { query, reader } = scenario();
  const userId = "' OR true --";
  const now = new Date("2040-01-01T00:00:00Z");
  await reader.list({ userId, now });

  const [statement, parameters] = query.mock.calls[0] ?? [];
  expect(statement).not.toContain(userId);
  expect(statement).not.toMatch(/ledger|fund_holds|room_token|wallet|select\s+\*/);
  expect(statement).toMatch(/p\.status in \('COMMITTED', 'WAITLISTED'\)/);
  expect(parameters).toEqual([userId, now]);
});

test("exposes only the place summary and the share as integer cents", async () => {
  const { query, reader } = scenario();
  const startAt = new Date("2040-01-02T00:00:00Z");
  const endAt = new Date("2040-01-02T01:00:00Z");
  query.mockResolvedValue([{
    session_id: "10000000-0000-4000-8000-000000000001", venue_name: "Sports hall", sport: "Badminton", region: "West",
    start_at: startAt, end_at: endAt, booking_share_cents: "1250", status: "WAITLISTED",
    room_token: "secret", booker_id: "other-user",
  }]);

  expect(await reader.list({ userId: "user", now: new Date() })).toEqual([{
    sessionId: "10000000-0000-4000-8000-000000000001", venueName: "Sports hall", sport: "Badminton", region: "West",
    startAt, endAt, status: "WAITLISTED", bookingShareCents: 1250,
  }]);
});

test("rejects a place in an unexpected status instead of showing it", async () => {
  const { query, reader } = scenario();
  query.mockResolvedValue([{
    session_id: "s", venue_name: "v", sport: "Tennis", region: "West", start_at: new Date(), end_at: new Date(),
    booking_share_cents: "100", status: "WITHDRAWN",
  }]);

  await expect(reader.list({ userId: "user", now: new Date() })).rejects.toThrow();
});

test.each([
  [[{ account_status: "ACTIVE" }], "ACTIVE"],
  [[{ account_status: "INACTIVE" }], "INACTIVE"],
  [[], null],
] as const)("reads the caller's account status %j", async (rows, expected) => {
  const { query, reader } = scenario();
  query.mockResolvedValue([...rows]);

  expect(await reader.accountStatus("user")).toBe(expected);
  expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("from profiles where user_id = $1"), ["user"]);
});
