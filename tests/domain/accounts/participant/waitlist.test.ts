import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestUser,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("join_WhenOnlyAvailableSeatIsReserved_JoinsOrdinaryWaitlistWithoutTakingReservation", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(10);
    const joinTime = hoursBeforeSessionStart(9);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(bookingSession, {
      participationId: "p-ben",
      now: withdrawalTime,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });

    // Act
    const admission = createTestUser({ userId: "dana" })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-dana",
        holdId: "h-dana",
        now: joinTime,
      });

    // Assert
    expect(admission).toEqual({
      kind: "WAITLISTED",
      participationId: "p-dana",
      instructions: [],
    });
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold?.state,
    ).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participantList.committedCount).toBe(1);
    expect(bookingSession.getAvailableSlots(joinTime)).toBe(0);
  });

  test("leaveWaitlist_WhenParticipantOwnsWaitingEntry_LeavesWithoutChangingCommitments", () => {
    // Arrange
    const waitlistDepartureTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const participant = createTestUser({ userId: "waiting" }).asParticipant();

    // Act
    participant.leaveWaitlist(bookingSession, {
      participationId: "p-waiting",
      now: waitlistDepartureTime,
    });

    // Assert
    expect(
      bookingSession.participantList.participations.map(
        (entry) => entry.status,
      ),
    ).toEqual(["COMMITTED", "COMMITTED", "LEFT_WAITLIST"]);
    expect(
      bookingSession.participantList.nextWaitlisted()?.userId,
    ).toBeUndefined();
    expect(bookingSession.getAvailableSlots(waitlistDepartureTime)).toBe(0);
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
        now: hoursBeforeSessionStart(48),
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
        now: hoursBeforeSessionStart(48),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
