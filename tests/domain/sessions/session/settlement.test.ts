import { describe, expect, test } from "vitest";
import {
  at,
  destination,
  end,
  join,
  session,
  sessionState,
} from "./session-fixtures";

describe("Session", () => {
  test("prepareSettlement_WhenHoldsNeedReleaseAndForfeiture_KeepsFundsPending", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    const batch = bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    // Assert
    expect(bookingSession.status).toBe("PAYOUT_PENDING");
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(
      bookingSession.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["FORFEITURE_DUE", "HELD"]);
  });

  test("prepareSettlement_WhenAnotherPayoutIsPending_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.prepareSettlement({
        actorId: "booker",
        payoutId: "another",
        idempotencyKey: "key2",
        destination,
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "PAYOUT_IN_PROGRESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenFailedPayoutIdIsReused_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    bookingSession.failSettlement("out", end);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.prepareSettlement({
        actorId: "booker",
        payoutId: "out",
        idempotencyKey: "new",
        destination,
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenSessionHasNoHolds_SettlesWithoutPayout", () => {
    // Arrange
    const bookingSession = session();

    // Act
    const batch = bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "unused",
      idempotencyKey: "unused",
      destination,
      now: end,
    });
    const status = bookingSession.status;

    // Assert
    expect(batch).toBeUndefined();
    expect(status).toBe("SETTLED");
  });

  test("completeSettlement_WhenCallbackIsStale_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => bookingSession.completeSettlement("stale", end)).toThrow(
      expect.objectContaining({ code: "STALE_PAYOUT" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("completeSettlement_WhenFailedAttemptIsRetriedWithNewIdentity_FinalizesHolds", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });
    bookingSession.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    // Act
    bookingSession.failSettlement("out", end);
    const statusAfterFailure = bookingSession.status;
    const retryBatch = bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "retry",
      idempotencyKey: "retry-key",
      destination,
      now: end,
    });
    const completion = bookingSession.completeSettlement("retry", end);

    // Assert
    expect(statusAfterFailure).toBe("AWAITING_PAYOUT");
    expect(retryBatch?.payoutId).toBe("retry");
    expect(
      completion.instructions.map((instruction) => instruction.kind),
    ).toEqual(["FORFEIT", "RELEASE"]);
    expect(bookingSession.status).toBe("SETTLED");
    expect(
      bookingSession.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["FORFEITED", "RELEASED"]);
    expect(
      bookingSession.participations[0]?.reliabilityOutcome(end)?.value,
    ).toBe(0);
  });
});
