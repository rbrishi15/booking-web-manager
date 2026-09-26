import { describe, expect, test } from "vitest";
import {
  at,
  before,
  hour,
  createTestUser,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("withdraw_WhenOneMillisecondBeforeRefundCutoff_RefundsHold", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(30 + 1 / hour),
      });

    // Assert
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(bookingSession.participations[0]?.hold?.state).toBe("REFUNDED");
  });

  test("withdraw_WhenExactlyAtRefundCutoff_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(30) });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("withdraw_WhenOneHourBeforeStart_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(1) });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("withdraw_WhenActorDoesNotOwnParticipation_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "other" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: before }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: start }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
