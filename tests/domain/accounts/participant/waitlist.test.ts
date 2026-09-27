import { describe, expect, test } from "vitest";
import {
  at,
  before,
  createTestUser,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("join_WhenOnlyAvailableSeatIsReserved_JoinsOrdinaryWaitlistWithoutTakingReservation", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
        replacementInviteeId: "cara",
      });

    // Act
    const admission = createTestUser({ userId: "dana" })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-dana",
        holdId: "h-dana",
        now: at(9),
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
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
  });

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
    expect(
      bookingSession.participantList.participations.map(
        (entry) => entry.status,
      ),
    ).toEqual(["COMMITTED", "COMMITTED", "LEFT_WAITLIST"]);
    expect(
      bookingSession.participantList.nextWaitlisted()?.userId,
    ).toBeUndefined();
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
