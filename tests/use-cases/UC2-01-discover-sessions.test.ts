import { ReliabilityScore, type User, type UUID } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  DiscoverSessions,
  type DiscoveredSession,
  type SessionDiscoveryCriteria,
} from "@/use-cases/sessions/DiscoverSessions";
import type {
  SessionDiscoveryReader,
  SessionDiscoveryTransaction,
} from "@/use-cases/sessions/session-discovery-transaction";
import { createTestUser } from "../domain/accounts/user-fixtures";

const now = new Date("2030-01-01T00:00:00Z");
const participantId = "10000000-0000-4000-8000-000000000001";

// Owner: Neoh (liang799) — /app/discover
describe("UC2-01 Discover Sessions", () => {
  test("loads the verified participant once before reading public listings", async () => {
    const user = createTestUser({
      userId: participantId,
      availableFundsCents: 0,
      reliabilityScore: ReliabilityScore.from(0),
    });
    const item = session(1);
    const { useCase, get, search, run } = discovery([item], user);

    const result = await useCase.forParticipant(participantId);

    expect(run).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledExactlyOnceWith(participantId);
    expect(search).toHaveBeenCalledExactlyOnceWith({}, now);
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(search.mock.invocationCallOrder[0]!);
    expect(result).toEqual([item]);
  });

  test("passes combined search, sport, region and date bounds to the listing reader", async () => {
    const criteria: SessionDiscoveryCriteria = {
      text: "Jurong", sport: "Badminton", region: "West",
      startsWithin: {
        from: new Date("2030-01-02T10:00:00Z"),
        before: new Date("2030-01-02T12:00:00Z"),
      },
    };
    const { useCase, search } = discovery();

    const result = await useCase.forParticipant(participantId, criteria);

    expect(search).toHaveBeenCalledExactlyOnceWith(criteria, now);
    expect(result).toEqual([]);
  });

  test.todo("filters sessions by region (derived from OneMap postal code)");

  test("captures the current time after loading and authorizing the participant", async () => {
    const { useCase, get, search, clock } = discovery();
    const afterLoading = new Date("2030-01-01T00:00:05Z");
    get.mockImplementationOnce(async () => {
      clock.now.mockReturnValue(afterLoading);
      return createTestUser({ userId: participantId });
    });

    await useCase.forParticipant(participantId);

    expect(clock.now).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({}, afterLoading);
  });

  test("rejects a missing participant before querying listings", async () => {
    const { useCase, search, clock } = discovery([], null);

    await expect(useCase.forParticipant(participantId)).rejects.toMatchObject({
      code: "NOT_FOUND", message: "User was not found",
    });
    expect(search).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  test("rejects an inactive participant before querying listings", async () => {
    const user = createTestUser({ userId: participantId, accountStatus: "INACTIVE" });
    const { useCase, search, clock } = discovery([], user);

    await expect(useCase.forParticipant(participantId)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(search).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  test("reloads the participant and observes deactivation between requests", async () => {
    const { useCase, get, search } = discovery();
    await useCase.forParticipant(participantId);
    get.mockResolvedValue(createTestUser({ userId: participantId, accountStatus: "INACTIVE" }));

    await expect(useCase.forParticipant(participantId)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(get).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledOnce();
  });

  test("preserves actor loading failures without querying listings", async () => {
    const { useCase, get, search } = discovery();
    const failure = new Error("User hydration failed");
    get.mockRejectedValue(failure);

    await expect(useCase.forParticipant(participantId)).rejects.toBe(failure);
    expect(search).not.toHaveBeenCalled();
  });

  test("preserves listing failures", async () => {
    const { useCase, search } = discovery();
    const failure = new Error("Session query failed");
    search.mockRejectedValue(failure);

    await expect(useCase.forParticipant(participantId)).rejects.toBe(failure);
  });

  test("waits for transaction completion and preserves commit failures", async () => {
    const { useCase, run, get, search } = discovery([session(1)]);
    const failure = new Error("Commit failed");
    run.mockImplementation(async (work) => {
      await work({ users: { get }, sessions: { search } });
      throw failure;
    });

    await expect(useCase.forParticipant(participantId)).rejects.toBe(failure);
    expect(search).toHaveBeenCalledOnce();
  });

  test("returns every matching summary without a page-size limit", async () => {
    const rows = Array.from({ length: 41 }, (_, index) => session(index + 1));
    const { useCase, search } = discovery(rows);
    const criteria = { sport: "Badminton" };

    const result = await useCase.forParticipant(participantId, criteria);

    expect(search).toHaveBeenCalledExactlyOnceWith(criteria, now);
    expect(result).toEqual(rows);
    expect(result).toHaveLength(41);
  });
});

function discovery(
  rows: readonly DiscoveredSession[] = [],
  user: User | null = createTestUser({ userId: participantId }),
) {
  const get = vi.fn<(id: UUID) => Promise<User | null>>().mockResolvedValue(user);
  const search = vi.fn<SessionDiscoveryReader["search"]>().mockResolvedValue(rows);
  const transaction: SessionDiscoveryTransaction = {
    run: (work) => work({ users: { get }, sessions: { search } }),
  };
  const run = vi.spyOn(transaction, "run");
  const clock = { now: vi.fn(() => now) };
  return { get, search, run, clock, useCase: new DiscoverSessions({ transaction, clock }) };
}

function session(id: number): DiscoveredSession {
  return {
    sessionId: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    venueName: "Jurong East Sports Hall", region: "West", sport: "Badminton",
    startAt: new Date("2030-01-02T10:00:00Z"), endAt: new Date("2030-01-02T12:00:00Z"),
    totalSlots: 8, bookingShareCents: 333,
  };
}
