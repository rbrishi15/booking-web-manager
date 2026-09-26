import { describe, expect, test } from "vitest";
import {
  before,
  end,
  readyBooker,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => readyBooker("other").cancel(bookingSession, before)).toThrow(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("changeVisibility_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").changeVisibility(bookingSession, "PRIVATE", before),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("verifyAttendance_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").verifyAttendance(bookingSession, {
        marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
