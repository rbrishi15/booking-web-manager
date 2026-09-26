import { describe, expect, test } from "vitest";
import {
  before,
  join,
  loadedUser,
  session,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("leaveWaitlist_WhenParticipantOwnsWaitingEntry_LeavesWithoutChangingCommitments", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    join(bookingSession, "waiting");
    const participant = loadedUser("waiting").asParticipant();

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
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    join(bookingSession, "waiting");
    const participant = loadedUser("other").asParticipant();
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
    const bookingSession = session();
    join(bookingSession, "a");
    const participant = loadedUser("a").asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.leaveWaitlist(bookingSession, {
        participationId: "p-a",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
