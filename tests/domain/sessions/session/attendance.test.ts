import { describe, expect, test } from "vitest";
import {
  at,
  destination,
  end,
  hour,
  join,
  session,
  sessionState,
} from "./session-fixtures";

describe("Session", () => {
  test("verifyAttendance_WhenSessionHasNotEnded_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.verifyAttendance({
        actorId: "booker",
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
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.verifyAttendance({
        actorId: "booker",
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
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ABSENT" }],
      now: end,
    });

    // Assert
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
  });

  test("prepareSettlement_WhenAttendanceIsIncomplete_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.prepareSettlement({
        actorId: "booker",
        payoutId: "out",
        idempotencyKey: "key",
        destination,
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("autoVerifyAttendance_WhenOneMillisecondBeforeDue_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ABSENT" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.autoVerifyAttendance(
        new Date(end.getTime() + 72 * hour - 1),
      ),
    ).toThrow(expect.objectContaining({ code: "AUTO_VERIFICATION_NOT_DUE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("autoVerifyAttendance_WhenExactlySeventyTwoHoursAfterEnd_VerifiesOnlyRemainingParticipants", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ABSENT" }],
      now: end,
    });

    // Act
    bookingSession.autoVerifyAttendance(new Date(end.getTime() + 72 * hour));

    // Assert
    expect(
      bookingSession.participations.map((participation) => [
        participation.attendance,
        participation.verificationMethod,
      ]),
    ).toEqual([
      ["ABSENT", "BOOKER"],
      ["ATTENDED", "AUTOMATIC"],
    ]);
  });
});
