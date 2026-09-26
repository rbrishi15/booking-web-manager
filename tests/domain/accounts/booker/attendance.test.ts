import { describe, expect, test } from "vitest";
import {
  at,
  end,
  join,
  loadedUser,
  readyBooker,
  session,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("verifyAttendance_WhenOwnerIsInactive_StillFinalizesAttendance", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const booker = loadedUser("booker", {
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    booker.verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });

    // Assert
    expect(bookingSession.participations[0]?.attendance).toBe("ATTENDED");
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
  });

  test("verifyAttendance_WhenSessionHasNotEnded_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().verifyAttendance(bookingSession, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: at(-1),
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenLaterMarkConflicts_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().verifyAttendance(bookingSession, {
        marks: [
          { participationId: "p-b", attendance: "ATTENDED" },
          { participationId: "p-a", attendance: "ABSENT" },
        ],
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_CONFLICT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenFinalParticipantIsMarked_AwaitsPayout", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-b", attendance: "ABSENT" }],
      now: end,
    });

    // Assert
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
  });
});
