import { describe, expect, test } from "vitest";
import {
  end,
  hour,
  join,
  readyBooker,
  session,
  sessionState,
} from "./session-fixtures";

describe("Session", () => {
  test("autoVerifyAttendance_WhenOneMillisecondBeforeDue_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    readyBooker().verifyAttendance(bookingSession, {
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
    readyBooker().verifyAttendance(bookingSession, {
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
