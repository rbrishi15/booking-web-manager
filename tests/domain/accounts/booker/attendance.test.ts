import { describe, expect, test } from "vitest";
import {
  at,
  createTestUser,
  end,
  readyBooker,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("verifyAttendance_WhenOwnerIsInactive_StillFinalizesAttendance", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const booker = createTestUser({
      userId: "booker",
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    booker.verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });

    // Assert
    expect(
      bookingSession.participantList.requireParticipation("p-alice").attendance,
    ).toBe("ATTENDED");
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
  });

  test("verifyAttendance_WhenSessionHasNotEnded_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().verifyAttendance(bookingSession, {
        marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
        now: at(-1),
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenLaterMarkConflicts_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().verifyAttendance(bookingSession, {
        marks: [
          { participationId: "p-ben", attendance: "ATTENDED" },
          { participationId: "p-alice", attendance: "ABSENT" },
        ],
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_CONFLICT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenFinalParticipantIsMarked_AwaitsPayout", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ABSENT" }],
      now: end,
    });

    // Assert
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
  });
});
