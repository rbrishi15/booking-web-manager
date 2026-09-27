import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  sessionEndsAt,
  readyBooker,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const cancellationTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").cancel(bookingSession, cancellationTime),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("changeVisibility_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const visibilityChangeTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").changeVisibility(
        bookingSession,
        "PRIVATE",
        visibilityChangeTime,
      ),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const attendanceVerificationTime = sessionEndsAt;
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").verifyAttendance(bookingSession, {
        marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
        now: attendanceVerificationTime,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").preparePayout(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
