import { describe, expect, test } from "vitest";
import {
  before,
  createTestUser,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("leaveWaitlist_WhenParticipantOwnsWaitingEntry_LeavesWithoutChangingCommitments", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const participant = createTestUser({ userId: "waiting" }).asParticipant();

    // Act
    participant.leaveWaitlist(bookingSession, {
      participationId: "p-waiting",
      now: before,
    });

    // Assert
    expect(bookingSession.participations.map((entry) => entry.status)).toEqual([
      "COMMITTED",
      "COMMITTED",
      "LEFT_WAITLIST",
    ]);
    expect(bookingSession.nextWaitlistedUserId).toBeUndefined();
    expect(bookingSession.getAvailableSlots(before)).toBe(0);
  });

  test("leaveWaitlist_WhenEntryBelongsToAnotherParticipant_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const participant = createTestUser({ userId: "other" }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.leaveWaitlist(bookingSession, {
        participationId: "p-waiting",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("leaveWaitlist_WhenParticipantIsCommitted_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    const participant = createTestUser({ userId: "alice" }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.leaveWaitlist(bookingSession, {
        participationId: "p-alice",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
