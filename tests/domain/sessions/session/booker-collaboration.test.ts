import { describe, expect, test } from "vitest";
import {
  before,
  end,
  join,
  readyBooker,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("applyBookerCancellation_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyBookerCancellation(readyBooker("other"), before),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("applyBookerCancellation_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyBookerCancellation(readyBooker(), start),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("applyBookerVisibilityChange_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyBookerVisibilityChange(
        readyBooker("other"),
        "PRIVATE",
        before,
      ),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("applyBookerRemoval_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyBookerRemoval(readyBooker("other"), "p-a", before),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("applyBookerAttendance_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyBookerAttendance(readyBooker("other"), {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareBookerSettlement_WhenBookerIsForeign_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.prepareBookerSettlement(readyBooker("other"), {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareBookerSettlement_WhenSessionHasNotEnded_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.prepareBookerSettlement(readyBooker(), {
        payoutId: "out",
        idempotencyKey: "key",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
