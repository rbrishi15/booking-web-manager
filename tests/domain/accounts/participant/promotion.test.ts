import { DomainError } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  at,
  before,
  createTestUser,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("promoteFromWaitlist_WhenQueueIsEmpty_ReturnsNoneBeforeValidatingHoldId", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act
    const result = createTestUser({ userId: "alice" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "",
        now: before,
      });

    // Assert
    expect(result).toEqual({ kind: "NONE", instructions: [] });
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("promoteFromWaitlist_WhenSessionHasStartedAndQueueIsEmpty_RejectsBeforeReturningNone", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .promoteFromWaitlist(bookingSession, {
          holdId: "",
          now: start,
        }),
    ).toThrow(
      expect.objectContaining({
        code: "SESSION_STARTED",
        message: "The session has started",
      }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("promoteFromWaitlist_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["first-waiter", "second-waiter"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    const previousState = sessionState(bookingSession);
    const awaiting =
      bookingSession.participantList.requireParticipation("p-alice");
    const failure = new DomainError(
      "INVALID_STATE",
      "Replacement refund failed",
    );
    const refund = vi
      .spyOn(awaiting, "refundReplacement")
      .mockImplementationOnce(() => {
        throw failure;
      });

    try {
      // Act & Assert
      expect(() =>
        createTestUser({ userId: "first-waiter" })
          .asParticipant()
          .promoteFromWaitlist(bookingSession, {
            holdId: "h-promoted",
            now: at(1),
          }),
      ).toThrow(failure);
      expect(refund).toHaveBeenCalledOnce();
      expect(sessionState(bookingSession)).toEqual(previousState);
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "first-waiter",
      );
    } finally {
      refund.mockRestore();
    }
  });

  test("promoteFromWaitlist_WhenLoadedUserDoesNotMatchNextWaiter_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["cara"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: before });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "other" })
        .asParticipant()
        .promoteFromWaitlist(bookingSession, {
          holdId: "h-cara",
          now: before,
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("promoteFromWaitlist_WhenReloadedWaiterHasFunds_PromotesFromUpdatedWallet", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const unfundedUser = createTestUser({
      userId: "cara",
      availableFundsCents: 0,
    });
    const waitlistAdmission = unfundedUser
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-cara",
        now: before,
      });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: before });
    const reloadedUser = createTestUser({
      userId: "cara",
      availableFundsCents: 500,
    });

    // Act
    const promotion = reloadedUser
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-cara",
        now: before,
      });

    // Assert
    expect(waitlistAdmission.kind).toBe("WAITLISTED");
    expect(promotion.kind).toBe("PROMOTED");
    expect(promotion.instructions[0]?.walletId).toBe("w-cara");
    expect(unfundedUser.wallet.getFunds().toCents()).toBe(0);
    expect(reloadedUser.wallet.getFunds().toCents()).toBe(500);
  });

  test("promoteFromWaitlist_WhenWaitersTieAndFirstCannotPay_PreservesQueuePriority", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });

    // Act
    const waitlistAdmission = createTestUser({
      userId: "cara",
      availableFundsCents: 0,
    })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: before,
      });
    createTestUser({ userId: "dana" }).asParticipant().join(bookingSession, {
      participationId: "p-dana",
      holdId: "h-dana",
      now: before,
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: before });
    const freshAdmission = createTestUser({ userId: "fresh" })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-fresh",
        holdId: "h-fresh",
        now: before,
      });
    const firstPromotion = createTestUser({
      userId: "cara",
      availableFundsCents: 0,
    })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-cara",
        now: before,
      });
    const nextWaiterAfterSkip =
      bookingSession.participantList.nextWaitlisted()?.userId;
    const secondPromotion = createTestUser({ userId: "dana" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-dana",
        now: before,
      });

    // Assert
    expect(waitlistAdmission).toMatchObject({
      kind: "WAITLISTED",
      instructions: [],
    });
    expect(freshAdmission.kind).toBe("WAITLISTED");
    expect(firstPromotion).toMatchObject({
      kind: "SKIPPED",
      reason: "INSUFFICIENT_FUNDS",
    });
    expect(nextWaiterAfterSkip).toBe("dana");
    expect(secondPromotion.kind).toBe("PROMOTED");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "fresh",
    );
  });
});
