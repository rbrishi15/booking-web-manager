import { describe, expect, test, vi } from "vitest";
import { DiscoverSessions, type DiscoveredSession, type SessionDiscoveryCriteria } from "@/use-cases/sessions/DiscoverSessions";
import type { SessionDiscoveryReader, SessionDiscoveryTransaction } from "@/use-cases/sessions/session-discovery-transaction";

const now = new Date("2030-01-01T00:00:00Z");
function discovery() {
  const search = vi.fn<SessionDiscoveryReader["search"]>().mockResolvedValue([]);
  const transaction: SessionDiscoveryTransaction = { run: (work) => work({ sessions: { search } }) };
  const run = vi.spyOn(transaction, "run");
  const clock = { now: vi.fn(() => now) };
  return { useCase: new DiscoverSessions({ transaction, clock }), search, run, clock };
}

describe("UC2-01 public session discovery", () => {
  test("reads public summaries without an account repository", async () => {
    const { useCase, search, run } = discovery();
    const item: DiscoveredSession = {
      sessionId: "session", venueName: "Jurong Sports Hall", sport: "Badminton", region: "West",
      startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"),
      totalSlots: 8, bookingShareCents: 333,
    };
    search.mockResolvedValue([item]);
    expect(await useCase.searchPublic()).toEqual([item]);
    expect(run).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledExactlyOnceWith({}, now);
  });
  test("passes combined filters and current time to the reader", async () => {
    const { useCase, search, clock } = discovery();
    const criteria: SessionDiscoveryCriteria = {
      text: "Jurong", sport: "Badminton", region: "West",
      startsWithin: { from: new Date("2030-01-02T10:00:00Z"), before: new Date("2030-01-02T12:00:00Z") },
    };
    await useCase.searchPublic(criteria);
    expect(search).toHaveBeenCalledExactlyOnceWith(criteria, now);
    expect(clock.now).toHaveBeenCalledOnce();
  });
  test("obtains a fresh listing cutoff on every request", async () => {
    const { useCase, search, clock } = discovery();
    await useCase.searchPublic();
    const later = new Date("2030-01-01T00:00:05Z");
    clock.now.mockReturnValue(later);
    await useCase.searchPublic();
    expect(search).toHaveBeenLastCalledWith({}, later);
  });
  test("propagates reader failures without returning partial results", async () => {
    const { useCase, search } = discovery();
    const failure = new Error("Database unavailable");
    search.mockRejectedValue(failure);
    await expect(useCase.searchPublic()).rejects.toBe(failure);
  });
});
