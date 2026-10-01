import { describe, expect, test, vi } from "vitest";
import { toDiscoveryPage } from "@/app/discover/contracts";
import { parseDiscoveryQuery, type DiscoveryCursor } from "@/app/discover/query";
import type { DiscoveredSession } from "@/use-cases/sessions/DiscoverSessions";

function session(id: number, overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: `10000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`,
    venueName: "Sports hall", sport: "Badminton", region: "West",
    startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"),
    totalSlots: 8, bookingShareCents: 333,
    ...overrides,
  };
}

function decode(cursor: string | null): DiscoveryCursor {
  if (cursor === null) throw new Error("Expected another page");
  const parsed = parseDiscoveryQuery(new URLSearchParams({ cursor }));
  if (parsed.status !== "valid" || parsed.after === undefined) throw new Error("Expected a valid cursor");
  return parsed.after;
}

describe("discovery browser pages", () => {
  test.each([0, 20, 21])("pages %i ordered summaries with continuation only when more remain", (count) => {
    const sessions = Array.from({ length: count }, (_, index) => session(index + 1));

    const page = toDiscoveryPage(sessions);

    expect(page.items.map((item) => item.sessionId)).toEqual(sessions.slice(0, 20).map((item) => item.sessionId));
    if (count <= 20) expect(page.nextCursor).toBeNull();
    else expect(decode(page.nextCursor)).toEqual({ startAt: sessions[19]?.startAt, sessionId: sessions[19]?.sessionId });
  });

  test("walks all 41 tied matches without duplicates or an empty final page", () => {
    const sessions = Array.from({ length: 41 }, (_, index) => session(index + 1));

    const first = toDiscoveryPage(sessions);
    const second = toDiscoveryPage(sessions, decode(first.nextCursor));
    const third = toDiscoveryPage(sessions, decode(second.nextCursor));

    expect([first.items.length, second.items.length, third.items.length]).toEqual([20, 20, 1]);
    expect(third.nextCursor).toBeNull();
    expect([...first.items, ...second.items, ...third.items].map((item) => item.sessionId))
      .toEqual(sessions.map((item) => item.sessionId));
  });

  test("compares UUID values case-insensitively at an equal timestamp", () => {
    const sessions = [session(9), session(10), session(11)];
    const after = { startAt: new Date("2030-01-02T10:00:00Z"), sessionId: session(10).sessionId.toUpperCase() };

    expect(toDiscoveryPage(sessions, after).items.map((item) => item.sessionId)).toEqual([session(11).sessionId]);
  });

  test("continues by tuple value when the cursor session no longer matches", () => {
    const sessions = [session(1), session(3), session(4)];
    const after = { startAt: session(2).startAt, sessionId: session(2).sessionId };

    expect(toDiscoveryPage(sessions, after).items.map((item) => item.sessionId))
      .toEqual([session(3).sessionId, session(4).sessionId]);
  });

  test("compares timestamps numerically before using the ID to break a tie", () => {
    const sessions = [
      session(99, { startAt: new Date("2030-01-02T09:59:59.999Z") }),
      session(10, { startAt: new Date("2030-01-02T10:00:00.000Z") }),
      session(11, { startAt: new Date("2030-01-02T10:00:00Z") }),
      session(1, { startAt: new Date("2030-01-02T10:00:00.001Z") }),
    ];
    const after = { startAt: new Date("2030-01-02T18:00:00+08:00"), sessionId: session(10).sessionId };

    expect(toDiscoveryPage(sessions, after).items.map((item) => item.sessionId))
      .toEqual([session(11).sessionId, session(1).sessionId]);
  });

  test.each([
    { startAt: new Date("2030-01-02T10:00:00Z"), sessionId: session(3).sessionId },
    { startAt: new Date("2030-01-02T10:00:00.001Z"), sessionId: session(1).sessionId },
  ])("returns no continuation when the cursor exhausts the matches", (after) => {
    expect(toDiscoveryPage([session(1), session(2), session(3)], after))
      .toEqual({ items: [], nextCursor: null });
  });

  test("serializes only the selected page and excludes all private fields", () => {
    const sessions = Array.from({ length: 22 }, (_, index) => ({
      ...session(index + 1), roomToken: "private-token", bookerId: "private-booker",
    }));
    const beforePage = sessions[0]!;
    const afterPage = sessions[21]!;
    const beforeSerialization = vi.spyOn(beforePage.endAt, "toISOString");
    const afterSerialization = vi.spyOn(afterPage.endAt, "toISOString");

    const page = toDiscoveryPage(sessions, { startAt: beforePage.startAt, sessionId: beforePage.sessionId });

    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toEqual({
      sessionId: sessions[1]?.sessionId, venueName: "Sports hall", sport: "Badminton", region: "West",
      startAt: "2030-01-02T10:00:00.000Z", endAt: "2030-01-02T12:00:00.000Z",
      totalSlots: 8, bookingShareCents: 333,
    });
    expect(JSON.stringify(page)).not.toContain("private");
    expect(beforeSerialization).not.toHaveBeenCalled();
    expect(afterSerialization).not.toHaveBeenCalled();
    expect(decode(page.nextCursor).sessionId).toBe(sessions[20]?.sessionId);
  });
});
