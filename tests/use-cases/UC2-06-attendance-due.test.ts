import { describe, expect, test, vi } from "vitest";
import type { Session, User } from "@/domain";
import { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import type { SessionManagementRepositories, SessionManagementTransaction } from "@/use-cases/sessions/session-management-transaction";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursAfterSessionEnd, readyBooker } from "../domain/sessions/session/session-fixtures";

describe("UC2-06 sessions awaiting the booker's attendance check", () => {
  test("lists ended sessions with their unverified committed participants", async () => {
    // Arrange: one ended session with two unverified players.
    const scenario = attendanceDue();
    scenario.listEndedOpen.mockResolvedValue([createTestSession({ committedUserIds: ["alice", "ben"] })]);

    // Act
    const due = await scenario.list.attendanceDueForBooker("booker");

    // Assert
    expect(scenario.listEndedOpen).toHaveBeenCalledExactlyOnceWith("booker", hoursAfterSessionEnd(1));
    expect(due).toEqual([{
      sessionId: "s", venueName: "Court", sport: "Badminton",
      startAt: expect.any(Date), endAt: expect.any(Date), unverifiedCount: 2,
    }]);
  });

  test("counts only players who are still unverified", async () => {
    // Arrange: Alice is already marked.
    const session = createTestSession({ committedUserIds: ["alice", "ben"] });
    readyBooker().verifyAttendance(session, { marks: [{ participationId: "p-alice", attendance: "ABSENT" }], now: hoursAfterSessionEnd(1) });
    const scenario = attendanceDue();
    scenario.listEndedOpen.mockResolvedValue([session]);

    // Act & Assert
    expect((await scenario.list.attendanceDueForBooker("booker"))[0]?.unverifiedCount).toBe(1);
  });

  test("leaves out an ended session with nobody left to verify", async () => {
    // Arrange: nobody committed, so there is nothing to check.
    const scenario = attendanceDue();
    scenario.listEndedOpen.mockResolvedValue([createTestSession({ committedUserIds: [], waitlistedUserIds: [] })]);

    // Act & Assert
    expect(await scenario.list.attendanceDueForBooker("booker")).toEqual([]);
  });

  test("rejects an inactive account before reading sessions", async () => {
    // Arrange
    const scenario = attendanceDue();
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));

    // Act & Assert
    await expect(scenario.list.attendanceDueForBooker("booker")).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(scenario.listEndedOpen).not.toHaveBeenCalled();
  });
});

function attendanceDue() {
  const getUser = vi.fn<(id: string) => Promise<User | null>>().mockResolvedValue(createTestUser({ userId: "booker" }));
  const listEndedOpen = vi.fn<SessionManagementRepositories["sessions"]["listEndedOpen"]>().mockResolvedValue([]);
  const repositories: SessionManagementRepositories = {
    users: { get: getUser },
    sessions: {
      get: async (): Promise<Session | null> => null,
      listUpcoming: async () => [],
      listEndedOpen,
      saveVisibility: async () => { throw new Error("Listing must not save"); },
    },
  };
  const transaction: SessionManagementTransaction = { run: (work) => work(repositories) };
  const clock = { now: () => hoursAfterSessionEnd(1) };
  return { getUser, listEndedOpen, list: new ListHostedSessions({ transaction, clock }) };
}
