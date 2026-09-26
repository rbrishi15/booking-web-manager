import { describe, expect, test } from "vitest";
import {
  at,
  end,
  join,
  loadedUser,
  readyBooker,
  session,
  sessionState,
} from "./session-fixtures";

describe("Session", () => {
  test("completeSettlement_WhenCallbackIsStale_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    loadedUser("a")
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-a", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
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
    loadedUser("a")
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-a", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });

    // Act
    bookingSession.failSettlement("out", end);
    const statusAfterFailure = bookingSession.status;
    const retryBatch = readyBooker().prepareSettlement(bookingSession, {
      payoutId: "retry",
      idempotencyKey: "retry-key",
      now: end,
    });
    const completion = bookingSession.completeSettlement("retry", end);

    // Assert
    expect(statusAfterFailure).toBe("AWAITING_PAYOUT");
    expect(retryBatch?.payoutId).toBe("retry");
    expect(retryBatch?.idempotencyKey).toBe("retry-key");
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
