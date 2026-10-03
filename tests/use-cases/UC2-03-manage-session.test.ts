import { describe, expect, test, vi } from "vitest";
import { Session, type User } from "@/domain";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";
import { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import type { SessionManagementTransaction, SessionManagementRepositories } from "@/use-cases/sessions/session-management-transaction";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursBeforeSessionStart, sessionDetails, sessionStartsAt, sessionState } from "../domain/sessions/session/session-fixtures";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-03 Manage Session", () => {
  describe("UC2-03a Toggle Public/Private", () => {
    test.each(["PRIVATE", "PUBLIC"] as const)("sets the explicit %s target and persists the domain change", async (visibility) => {
      const scenario = management();
      const before = sessionState(scenario.session);
      const result = await scenario.toggle.forBooker("booker", "s", visibility);
      expect(result).toEqual({ sessionId: "s", visibility });
      expect(scenario.getUser).toHaveBeenCalledExactlyOnceWith("booker");
      expect(scenario.getSession).toHaveBeenCalledExactlyOnceWith("s");
      expect(scenario.saveVisibility).toHaveBeenCalledExactlyOnceWith(scenario.session);
      expect(sessionState(scenario.session)).toEqual({ ...before, visibility });
    });

    test("captures time after both aggregate reads so a session that just started cannot change", async () => {
      const scenario = management();
      scenario.getSession.mockImplementationOnce(async () => {
        scenario.clock.now.mockReturnValue(sessionStartsAt);
        return scenario.session;
      });
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toMatchObject({ code: "SESSION_STARTED" });
      expect(scenario.clock.now).toHaveBeenCalledOnce();
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test.each(["user", "session"])("rejects a missing %s without writing", async (missing) => {
      const scenario = management();
      if (missing === "user") scenario.getUser.mockResolvedValue(null);
      else scenario.getSession.mockResolvedValue(null);
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test("checks current account status on every invocation including same-value retries", async () => {
      const scenario = management();
      await scenario.toggle.forBooker("booker", "s", "PUBLIC");
      scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
      await expect(scenario.toggle.forBooker("booker", "s", "PUBLIC")).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
      expect(scenario.getUser).toHaveBeenCalledTimes(2);
      expect(scenario.saveVisibility).toHaveBeenCalledOnce();
    });

    test("rejects an inactive account loaded inside the transaction", async () => {
      const scenario = management();
      scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
      expect(scenario.getSession).not.toHaveBeenCalled();
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test("rejects a foreign owner even for the current visibility", async () => {
      const scenario = management();
      scenario.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
      await expect(scenario.toggle.forBooker("other", "s", "PUBLIC")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test.each(["PRIVATE", "PUBLIC"] as const)("rejects %s when the session is full, without a same-value shortcut", async (visibility) => {
      const scenario = management(createTestSession({ committedUserIds: ["alice", "bob"] }));
      await expect(scenario.toggle.forBooker("booker", "s", visibility)).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test("counts a personal replacement reservation as occupied capacity", async () => {
      const session = createTestSession({ committedUserIds: ["alice", "bob"] });
      const now = hoursBeforeSessionStart(10);
      createTestUser({ userId: "alice" }).asParticipant().withdraw(session, { participationId: "p-alice", replacementMode: "DIRECT_INVITE", replacementInviteeId: "carol", now });
      const scenario = management(session);
      scenario.clock.now.mockReturnValue(now);
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
      expect(session.participantList.committedCount).toBe(1);
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test.each(["CANCELLED", "SETTLED"] as const)("rejects a %s session without persisting", async (status) => {
      const scenario = management(new Session(sessionDetails({ status })));
      await expect(scenario.toggle.forBooker("booker", "s", "PUBLIC")).rejects.toMatchObject({ code: "SESSION_CLOSED" });
      expect(scenario.saveVisibility).not.toHaveBeenCalled();
    });

    test.each(["getUser", "getSession", "saveVisibility"] as const)("preserves %s infrastructure failures", async (operation) => {
      const scenario = management();
      const failure = new Error("Database unavailable");
      scenario[operation].mockRejectedValue(failure);
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toBe(failure);
    });

    test("waits for commit and never reports a failed transaction as saved", async () => {
      const scenario = management();
      const failure = new Error("Commit failed");
      scenario.run.mockImplementation(async (work) => { await work(scenario.repositories); throw failure; });
      await expect(scenario.toggle.forBooker("booker", "s", "PRIVATE")).rejects.toBe(failure);
      expect(scenario.saveVisibility).toHaveBeenCalledOnce();
    });
  });

  describe("UC2-03b Remove Participant", () => {
    test.todo(
      "removes a participant and reverses their held funds appropriately",
    );
    test.todo("frees the vacated slot for waitlist promotion");
  });
});

describe("Hosted session listing", () => {
  test("returns only display facts while retaining full sessions and repository ordering", async () => {
    const scenario = management();
    const full = createTestSession({ committedUserIds: ["alice", "bob"] });
    scenario.listUpcoming.mockResolvedValue([full, new Session(sessionDetails({ sessionId: "second" }))]);
    const result = await scenario.list.forBooker("booker");
    expect(scenario.listUpcoming).toHaveBeenCalledExactlyOnceWith("booker", hoursBeforeSessionStart(48));
    expect(result).toEqual([
      { sessionId: "s", venueName: "Court", sport: "Badminton", region: "North", startAt: full.booking.startAt, endAt: full.booking.endAt, visibility: "PUBLIC", availableSlots: 0, actions: [{ name: "preview-cancellation" }] },
      { sessionId: "second", venueName: "Court", sport: "Badminton", region: "North", startAt: full.booking.startAt, endAt: full.booking.endAt, visibility: "PUBLIC", availableSlots: 2, actions: [{ name: "set-visibility", visibility: "PRIVATE" }, { name: "preview-cancellation" }] },
    ]);
    expect(scenario.saveVisibility).not.toHaveBeenCalled();
  });

  test("unverified owners retain management actions and projecting them does not mutate session state", async () => {
    const scenario = management();
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", emailVerified: false }));
    scenario.listUpcoming.mockResolvedValue([scenario.session]);
    const before = sessionState(scenario.session);
    expect((await scenario.list.forBooker("booker"))[0]!.actions).toEqual([{ name: "set-visibility", visibility: "PRIVATE" }, { name: "preview-cancellation" }]);
    expect(sessionState(scenario.session)).toEqual(before);
    expect(scenario.saveVisibility).not.toHaveBeenCalled();
  });

  test("a session that has started advertises no new management transitions", async () => {
    const scenario = management();
    scenario.listUpcoming.mockResolvedValue([scenario.session]);
    scenario.clock.now.mockReturnValue(sessionStartsAt);
    expect((await scenario.list.forBooker("booker"))[0]!.actions).toEqual([]);
  });

  test("rejects inactive and missing users before querying owned sessions", async () => {
    const scenario = management();
    scenario.getUser.mockResolvedValueOnce(null).mockResolvedValueOnce(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
    await expect(scenario.list.forBooker("booker")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(scenario.list.forBooker("booker")).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(scenario.listUpcoming).not.toHaveBeenCalled();
  });

  test("returns an empty list and propagates a failed list query", async () => {
    const scenario = management();
    expect(await scenario.list.forBooker("booker")).toEqual([]);
    const failure = new Error("List read failed");
    scenario.listUpcoming.mockRejectedValue(failure);
    await expect(scenario.list.forBooker("booker")).rejects.toBe(failure);
  });
});

/** Wires both management use cases to controllable repository mocks and a fixed clock. */
function management(session = createTestSession()) {
  const getUser = vi.fn<(id: string) => Promise<User | null>>().mockResolvedValue(createTestUser({ userId: "booker" }));
  const getSession = vi.fn<(id: string) => Promise<Session | null>>().mockResolvedValue(session);
  const listUpcoming = vi.fn<SessionManagementRepositories["sessions"]["listUpcoming"]>().mockResolvedValue([]);
  const saveVisibility = vi.fn<SessionManagementRepositories["sessions"]["saveVisibility"]>().mockResolvedValue(undefined);
  const repositories = { users: { get: getUser }, sessions: { get: getSession, listUpcoming, saveVisibility } };
  const transaction: SessionManagementTransaction = { run: (work) => work(repositories) };
  const run = vi.spyOn(transaction, "run");
  const clock = { now: vi.fn(() => hoursBeforeSessionStart(48)) };
  return { session, repositories, getUser, getSession, listUpcoming, saveVisibility, run, clock, toggle: new ToggleSessionVisibility({ transaction, clock }), list: new ListHostedSessions({ transaction, clock }) };
}
