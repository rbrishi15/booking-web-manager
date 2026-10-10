import { describe, expect, test, vi } from "vitest";
import { ListJoinedSessions, type JoinedSessionsReader } from "@/use-cases/sessions/ListJoinedSessions";

const userId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2040-01-01T00:00:00Z");

function scenario(status: "ACTIVE" | "INACTIVE" | null = "ACTIVE") {
  const reader = {
    accountStatus: vi.fn<JoinedSessionsReader["accountStatus"]>().mockResolvedValue(status),
    list: vi.fn<JoinedSessionsReader["list"]>().mockResolvedValue([]),
  };
  return { reader, joined: new ListJoinedSessions({ reader, clock: { now: () => now } }) };
}

describe("UC2-05 list the sessions a participant has joined", () => {
  test("reads the verified participant's places as of the current time", async () => {
    // Arrange
    const { reader, joined } = scenario();
    const place = {
      sessionId: "20000000-0000-4000-8000-000000000001", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central",
      startAt: new Date("2040-01-02T10:00:00Z"), endAt: new Date("2040-01-02T12:00:00Z"), status: "COMMITTED" as const, bookingShareCents: 1250,
    };
    reader.list.mockResolvedValue([place]);

    // Act
    const result = await joined.forParticipant(userId);

    // Assert
    expect(result).toEqual([place]);
    expect(reader.accountStatus).toHaveBeenCalledExactlyOnceWith(userId);
    expect(reader.list).toHaveBeenCalledExactlyOnceWith({ userId, now });
  });

  test.each([
    ["an inactive account", "INACTIVE" as const, "INACTIVE_ACCOUNT"],
    ["a user without a profile", null, "NOT_FOUND"],
  ])("rejects %s before reading any sessions", async (_name, status, code) => {
    // Arrange
    const { reader, joined } = scenario(status);

    // Act & Assert
    await expect(joined.forParticipant(userId)).rejects.toMatchObject({ code });
    expect(reader.list).not.toHaveBeenCalled();
  });

  test("does not disguise a failed read as having joined nothing", async () => {
    // Arrange
    const { reader, joined } = scenario();
    const failure = new Error("Database unavailable");
    reader.list.mockRejectedValue(failure);

    // Act & Assert
    await expect(joined.forParticipant(userId)).rejects.toBe(failure);
  });
});
