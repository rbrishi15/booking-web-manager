import { describe, expect, test } from "vitest";
import {
  DiscoverSessions,
  type DiscoveredSession,
  type SessionDiscoveryReader,
} from "@/use-cases/sessions/DiscoverSessions";

const now = new Date("2030-01-01T00:00:00Z");
const session = (id: number, overrides: Partial<DiscoveredSession> = {}): DiscoveredSession => ({
  sessionId: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  venueName: "Jurong East Sports Hall", region: "West", sport: "Badminton",
  startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"),
  totalSlots: 8, bookingShareCents: 333, ...overrides,
});

/** Contract fake; the same filtering semantics are verified against PostgreSQL. */
function discovery(rows: readonly DiscoveredSession[]) {
  const reader: SessionDiscoveryReader = {
    search: async (query) => rows
      .filter((row) => row.startAt > query.now)
      .filter((row) => query.sport === undefined || row.sport === query.sport)
      .filter((row) => query.region === undefined || row.region === query.region)
      .filter((row) => query.startAtFrom === undefined || row.startAt >= query.startAtFrom)
      .filter((row) => query.startAtBefore === undefined || row.startAt < query.startAtBefore)
      .filter((row) => query.cursor === undefined || row.startAt.toISOString() > query.cursor.startAt ||
        (row.startAt.toISOString() === query.cursor.startAt && row.sessionId > query.cursor.sessionId))
      .toSorted((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId))
      .slice(0, query.limit),
  };
  return new DiscoverSessions({ reader, clock: { now: () => now } });
}

// Owner: Neoh (liang799) — /app/discover
describe("UC2-01 Discover Sessions", () => {
  test("filters sessions by sport", async () => {
    const badminton = session(1);
    const tennis = session(2, { sport: "Tennis" });
    const result = await discovery([badminton, tennis]).search({ sport: "Tennis" });
    expect(result.items).toEqual([tennis]);
  });
  test.todo("filters sessions by region (derived from OneMap postal code)");
  test("filters sessions by stored region pending OneMap provenance", async () => {
    const west = session(1);
    const east = session(2, { region: "East" });
    expect((await discovery([west, east]).search({ region: "West" })).items).toEqual([west]);
  });

  test("filters sessions by date and time", async () => {
    const before = session(1, { startAt: new Date("2030-01-02T09:59:59Z") });
    const first = session(2);
    const last = session(3, { startAt: new Date("2030-01-02T11:59:59Z") });
    const after = session(4, { startAt: new Date("2030-01-02T12:00:00Z") });
    expect((await discovery([before, first, last, after]).search({
      startAtFrom: new Date("2030-01-02T10:00:00Z"),
      startAtBefore: new Date("2030-01-02T12:00:00Z"),
    })).items).toEqual([first, last]);
  });

  test("combines filters and returns an empty page for no match", async () => {
    const useCase = discovery([session(1), session(2, { region: "East", sport: "Tennis" })]);
    expect(await useCase.search({ sport: "Tennis", region: "West" })).toEqual({ items: [], nextCursor: null });
    expect((await useCase.search({ sport: "Tennis", region: "East" })).items.map((row) => row.sessionId)).toEqual([session(2).sessionId]);
  });

  test("uses the current clock to exclude sessions starting now or earlier", async () => {
    const upcoming = session(3);
    const result = await discovery([
      session(1, { startAt: new Date(now.getTime() - 1) }), session(2, { startAt: now }), upcoming,
    ]).search({});
    expect(result.items).toEqual([upcoming]);
  });

  test("paginates ties without omitting or repeating sessions", async () => {
    const rows = Array.from({ length: 41 }, (_, index) => session(index + 1));
    const useCase = discovery(rows.toReversed());
    const first = await useCase.search({});
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual({ startAt: rows[19]?.startAt.toISOString(), sessionId: rows[19]?.sessionId });
    if (first.nextCursor === null) throw new Error("Expected a second page");
    const second = await useCase.search({ cursor: first.nextCursor });
    expect(second.items).toHaveLength(20);
    if (second.nextCursor === null) throw new Error("Expected a third page");
    const third = await useCase.search({ cursor: second.nextCursor });
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items]).toEqual(rows);
  });

  test("exactly twenty remaining results do not advertise an empty next page", async () => {
    const result = await discovery(Array.from({ length: 20 }, (_, index) => session(index + 1))).search({});
    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).toBeNull();
  });
});
