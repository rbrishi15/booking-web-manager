import { expect, test, vi } from "vitest";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresSessionDiscoveryReader } from "@/lib/sessions/postgres-session-discovery-reader";

function scenario() {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([]);
  return { query, reader: new PostgresSessionDiscoveryReader({ query: query as SqlExecutor["query"] }) };
}

test("queries explicit public upcoming fields without availability, ledger, or roster restrictions", async () => {
  const { query, reader } = scenario();
  const now = new Date("2030-01-01T00:00:00Z");
  await reader.search({ now, limit: 21 });
  const statement = query.mock.calls[0]?.[0];
  expect(statement).toContain("visibility = 'PUBLIC'");
  expect(statement).toContain("status = 'OPEN'");
  expect(statement).toContain("start_at > $1");
  expect(statement).toContain("order by start_at asc, session_id asc");
  expect(statement).not.toMatch(/room_token|booker_id|\*|ledger|participations|fund_holds/);
  expect(query.mock.calls[0]?.[1]).toEqual([now, 21]);
});

test("parameterizes combined bounds and cursor, including hostile filter input", async () => {
  const { query, reader } = scenario();
  const now = new Date("2030-01-01T00:00:00Z");
  const from = new Date("2030-01-02T00:00:00Z");
  const before = new Date("2030-01-02T12:00:00Z");
  const sport = "Tennis'; drop table sessions; --";
  const cursor = { startAt: "2030-01-02T03:00:00.000Z", sessionId: "10000000-0000-4000-8000-000000000001" };
  await reader.search({ now, limit: 21, sport, region: "West", startAtFrom: from, startAtBefore: before, cursor });
  expect(query.mock.calls[0]?.[0]).toContain("start_at >= $4 and start_at < $5");
  expect(query.mock.calls[0]?.[0]).toContain("(start_at, session_id) > ($6::timestamptz, $7::uuid)");
  expect(query.mock.calls[0]?.[0]).not.toContain(sport);
  expect(query.mock.calls[0]?.[1]).toEqual([now, sport, "West", from, before, cursor.startAt, cursor.sessionId, 21]);
});

test("matches search text literally across sport or venue using one bound pattern", async () => {
  const { query, reader } = scenario();
  const now = new Date("2030-01-01T00:00:00Z");
  const q = "100%_O'Brien\\Court'; select pg_sleep(10); --";
  await reader.search({ now, limit: 21, q, sport: "Tennis", region: "West" });
  const [statement, parameters] = query.mock.calls[0] ?? [];
  expect(statement).toContain("(sport ilike $2 or venue_name ilike $2) and sport = $3 and region = $4");
  expect(statement).not.toContain(q);
  expect(parameters).toEqual([now, "%100\\%\\_O'Brien\\\\Court'; select pg\\_sleep(10); --%", "Tennis", "West", 21]);
});

test("converts safe bigint cents and projects only listing fields", async () => {
  const { query, reader } = scenario();
  query.mockResolvedValue([{
    session_id: "10000000-0000-4000-8000-000000000001", venue_name: "Sports hall",
    sport: "Badminton", region: "West", start_at: new Date("2030-01-02T00:00:00Z"),
    end_at: new Date("2030-01-02T01:00:00Z"), total_slots: 8, booking_share_cents: "333",
    room_token: "private-room",
  }]);
  const [item] = await reader.search({ now: new Date(), limit: 21 });
  expect(item).toMatchObject({ venueName: "Sports hall", bookingShareCents: 333, totalSlots: 8 });
  expect(item).not.toHaveProperty("roomToken");
  expect(item).not.toHaveProperty("room_token");
});

test("rejects unsafe stored monetary values without rounding", async () => {
  const { query, reader } = scenario();
  query.mockResolvedValue([{
    session_id: "session", venue_name: "Sports hall", sport: "Badminton", region: "West",
    start_at: new Date(), end_at: new Date(), total_slots: 8, booking_share_cents: "9007199254740992",
  }]);
  await expect(reader.search({ now: new Date(), limit: 21 })).rejects.toThrow();
});
