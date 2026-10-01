import {
  DomainError,
  FundHold,
  Money,
  Participation,
  Session,
  type PayoutLine,
} from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  sessionEndsAt,
  pendingPayoutDetails,
  sessionState,
  verifiedParticipation,
} from "./session-fixtures";

describe("Session", () => {
  test("completeSettlement_WhenRestoredBatchOmitsPayableHold_LeavesAllFundsAndHistoryPending", () => {
    // Arrange
    const details = pendingPayoutDetails(["alice", "ben"]);
    const batch = details.pendingSettlement!;
    const bookingSession = new Session({
      ...details,
      pendingSettlement: { ...batch, lines: batch.lines.slice(0, 1) },
    });
    const previousList = bookingSession.participantList;
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.completeSettlement("out", sessionEndsAt),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList).toBe(previousList);
    expect(bookingSession.status).toBe("PAYOUT_PENDING");
    expect(bookingSession.payoutAttemptIds).toEqual(["out"]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual(["key"]);
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["HELD", "HELD"]);
  });

  test("completeSettlement_WhenCallbackIsStale_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.completeSettlement("stale", sessionEndsAt),
    ).toThrow(expect.objectContaining({ code: "STALE_PAYOUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("completeSettlement_WhenCompletionDateIsInvalid_LeavesAllHoldsPending", () => {
    // Arrange
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.completeSettlement("out", new Date(Number.NaN)),
    ).toThrow(DomainError);
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("completeSettlement_WhenSecondHoldFails_PreservesAllHolds", () => {
    // Arrange
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const previousState = sessionState(bookingSession);
    const failure = vi
      .spyOn(
        bookingSession.participantList.requireParticipation("p-ben"),
        "settleHold",
      )
      .mockImplementationOnce(() => {
        throw new DomainError("INVALID_STATE", "Second line rejected");
      });

    // Act & Assert
    try {
      expect(() =>
        bookingSession.completeSettlement("out", sessionEndsAt),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_STATE",
          message: "Second line rejected",
        }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    } finally {
      failure.mockRestore();
    }
  });

  test("completeSettlement_WhenSecondHoldFailureIsRetried_ReleasesAllHolds", () => {
    // Arrange
    const completionTime = sessionEndsAt;
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const failure = vi
      .spyOn(
        bookingSession.participantList.requireParticipation("p-ben"),
        "settleHold",
      )
      .mockImplementationOnce(() => {
        throw new DomainError("INVALID_STATE", "Second line rejected");
      });
    try {
      expect(() =>
        bookingSession.completeSettlement("out", completionTime),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    } finally {
      failure.mockRestore();
    }

    // Act
    const completion = bookingSession.completeSettlement("out", completionTime);

    // Assert
    expect(completion.instructions).toHaveLength(2);
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["RELEASED", "RELEASED"]);
    expect(bookingSession.pendingSettlement).toBeUndefined();
  });

  test("completeSettlement_WhenPayoutHasReleaseAndForfeiture_FinalizesBothHolds", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const completionTime = sessionEndsAt;
    const reliabilityEvaluationTime = sessionEndsAt;
    const details = pendingPayoutDetails(["alice", "ben"]);
    const alice = withdrawnParticipationWithForfeitureDue(
      "alice",
      withdrawalTime,
    );
    const ben = verifiedParticipation("ben", "ATTENDED");
    const bookingSession = new Session({
      ...details,
      participations: [alice, ben],
      pendingSettlement: {
        ...details.pendingSettlement!,
        lines: [
          payoutLineFor(alice.hold!, "FORFEIT"),
          payoutLineFor(ben.hold!, "RELEASE"),
        ],
      },
    });

    // Act
    const completion = bookingSession.completeSettlement("out", completionTime);

    // Assert
    expect(
      completion.instructions.map((instruction) => instruction.kind),
    ).toEqual(["FORFEIT", "RELEASE"]);
    expect(
      completion.instructions.map((instruction) => instruction.payoutId),
    ).toEqual(["out", "out"]);
    expect(bookingSession.status).toBe("SETTLED");
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["FORFEITED", "RELEASED"]);
    expect(
      bookingSession.participantList
        .requireParticipation("p-alice")
        .reliabilityOutcome(reliabilityEvaluationTime)?.value,
    ).toBe(0);
  });

  test("completeSettlement_WhenCurrentAttemptIsARetry_UsesRetryPayoutIdentity", () => {
    // Arrange
    const details = pendingPayoutDetails(["alice"]);
    const bookingSession = new Session({
      ...details,
      pendingSettlement: {
        ...details.pendingSettlement!,
        payoutId: "retry",
        idempotencyKey: "retry-key",
      },
      payoutAttemptIds: ["out", "retry"],
      payoutIdempotencyKeys: ["key", "retry-key"],
    });

    // Act
    const completion = bookingSession.completeSettlement(
      "retry",
      sessionEndsAt,
    );

    // Assert
    expect(completion.instructions).toEqual([
      expect.objectContaining({
        kind: "RELEASE",
        participationId: "p-alice",
        payoutId: "retry",
      }),
    ]);
    const alice =
      bookingSession.participantList.requireParticipation("p-alice");
    expect(alice.hold?.payoutId).toBe("retry");
    expect(alice.hold?.state).toBe("RELEASED");
    expect(bookingSession.status).toBe("SETTLED");
    expect(bookingSession.pendingSettlement).toBeUndefined();
  });

  test("failSettlement_WhenPayoutIsPending_PreservesHoldsAndAttemptHistory", () => {
    // Arrange
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const previousList = bookingSession.participantList;

    // Act
    bookingSession.failSettlement("out", sessionEndsAt);

    // Assert
    expect(bookingSession.status).toBe("AWAITING_PAYOUT");
    expect(bookingSession.pendingSettlement).toBeUndefined();
    expect(bookingSession.participantList).toBe(previousList);
    expect(bookingSession.payoutAttemptIds).toEqual(["out"]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual(["key"]);
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["HELD", "HELD"]);
  });
});

function withdrawnParticipationWithForfeitureDue(
  userId: string,
  withdrawnAt: Date,
): Participation {
  const committedAt = hoursBeforeSessionStart(48);
  return new Participation({
    participationId: `p-${userId}`,
    userId,
    status: "WITHDRAWN",
    attendance: "UNVERIFIED",
    committedAt,
    withdrawnAt,
    hold: new FundHold({
      holdId: `h-${userId}`,
      participationId: `p-${userId}`,
      holdingAccountId: "platform",
      walletId: `w-${userId}`,
      amount: Money.fromCents(500),
      state: "FORFEITURE_DUE",
      createdAt: committedAt,
    }),
  });
}

function payoutLineFor(hold: FundHold, kind: PayoutLine["kind"]): PayoutLine {
  return {
    holdId: hold.holdId,
    participationId: hold.participationId,
    holdingAccountId: hold.holdingAccountId,
    walletId: hold.walletId,
    amount: hold.amount,
    kind,
  };
}
