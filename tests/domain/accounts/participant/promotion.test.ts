import { DomainError } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestUser,
  createTestSession,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("promoteFromWaitlist_WhenFirstWaiterHasPendingInvitation_RejectsWithoutAcceptingOrMovingQueue", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(10);
    const promotionTime = hoursBeforeSessionStart(9);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["cara", "dana"],
    });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(bookingSession, {
      participationId: "p-ben",
      now: withdrawalTime,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });
    const queueSequence = bookingSession.participantList.nextQueueSequence;
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "cara" })
        .asParticipant()
        .promoteFromWaitlist(bookingSession, {
          holdId: "h-cara",
          now: promotionTime,
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(
      bookingSession.participantList.requireParticipation("p-cara").status,
    ).toBe("WAITLISTED");
    expect(
      bookingSession.participantList.personalReplacementForInvitee("cara")
        ?.participationId,
    ).toBe("p-ben");
    expect(bookingSession.participantList.committedCount).toBe(1);
    expect(bookingSession.getAvailableSlots(promotionTime)).toBe(0);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "cara",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
  });

  test("promoteFromWaitlist_WhenOnlyVacancyIsReserved_RejectsWithoutMovingTheQueue", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(10);
    const promotionTime = hoursBeforeSessionStart(9);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana", "evan"],
    });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(bookingSession, {
      participationId: "p-ben",
      now: withdrawalTime,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "dana" })
        .asParticipant()
        .promoteFromWaitlist(bookingSession, {
          holdId: "h-dana",
          now: promotionTime,
        }),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
  });

  test("promoteFromWaitlist_WhenAnOlderWithdrawalIsReserved_RefundsOnlyTheOpenWithdrawal", () => {
    // Arrange
    const benWithdrawalTime = hoursBeforeSessionStart(10);
    const aliceWithdrawalTime = hoursBeforeSessionStart(9);
    const promotionTime = hoursBeforeSessionStart(8);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana", "evan"],
    });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(bookingSession, {
      participationId: "p-ben",
      now: benWithdrawalTime,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: aliceWithdrawalTime,
        replacementMode: "OPEN_SLOT",
      });

    // Act
    const promotion = createTestUser({ userId: "dana" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-dana",
        now: promotionTime,
      });

    // Assert
    expect(promotion.kind).toBe("PROMOTED");
    expect(promotion.refundedParticipationId).toBe("p-alice");
    expect(
      promotion.instructions.map((instruction) => instruction.kind),
    ).toEqual(["LOCK", "REFUND"]);
    expect(
      bookingSession.participantList.requireParticipation("p-dana")
        .replacesParticipationId,
    ).toBe("p-alice");
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold?.state,
    ).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "evan",
    );
    expect(bookingSession.getAvailableSlots(promotionTime)).toBe(0);
  });

  test("promoteFromWaitlist_WhenQueueIsEmpty_ReturnsNoneBeforeValidatingHoldId", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act
    const result = createTestUser({ userId: "alice" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "",
        now: hoursBeforeSessionStart(48),
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
          now: sessionStartsAt,
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
    const withdrawalTime = hoursBeforeSessionStart(2);
    const promotionTime = hoursBeforeSessionStart(1);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["first-waiter", "second-waiter"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
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
            now: promotionTime,
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
    const withdrawalTime = hoursBeforeSessionStart(48);
    const promotionTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["cara"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "other" })
        .asParticipant()
        .promoteFromWaitlist(bookingSession, {
          holdId: "h-cara",
          now: promotionTime,
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("promoteFromWaitlist_WhenReloadedWaiterHasFunds_PromotesFromUpdatedWallet", () => {
    // Arrange
    const waitlistJoinTime = hoursBeforeSessionStart(48);
    const withdrawalTime = hoursBeforeSessionStart(48);
    const promotionTime = hoursBeforeSessionStart(48);
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
        now: waitlistJoinTime,
      });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    const reloadedUser = createTestUser({
      userId: "cara",
      availableFundsCents: 500,
    });

    // Act
    const promotion = reloadedUser
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-cara",
        now: promotionTime,
      });

    // Assert
    expect(waitlistAdmission.kind).toBe("WAITLISTED");
    expect(promotion.kind).toBe("PROMOTED");
    expect(promotion.instructions[0]?.walletId).toBe("w-cara");
    expect(unfundedUser.wallet.getAvailableBalance().toCents()).toBe(0);
    expect(reloadedUser.wallet.getAvailableBalance().toCents()).toBe(500);
  });

  test("promoteFromWaitlist_WhenFirstWaiterCannotPay_SkipsThemAndSelectsNextWaiter", () => {
    // Arrange
    const promotionTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["ben"],
      waitlistedUserIds: ["cara", "dana", "evan"],
    });
    const participant = createTestUser({
      userId: "cara",
      availableFundsCents: 0,
    }).asParticipant();
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const promotion = participant.promoteFromWaitlist(bookingSession, {
      holdId: "h-cara",
      now: promotionTime,
    });

    // Assert
    expect(promotion).toEqual({
      kind: "SKIPPED",
      participationId: "p-cara",
      reason: "INSUFFICIENT_FUNDS",
      instructions: [],
    });
    expect(
      bookingSession.participantList.requireParticipation("p-cara").status,
    ).toBe("LEFT_WAITLIST");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
    expect(bookingSession.getAvailableSlots(promotionTime)).toBe(1);
  });

  test("promoteFromWaitlist_WhenFirstTiedWaiterWasSkipped_PromotesNextWaiter", () => {
    // Arrange
    const firstPromotionTime = hoursBeforeSessionStart(48);
    const nextPromotionTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["ben"],
      waitlistedUserIds: ["cara", "dana", "evan"],
    });
    createTestUser({ userId: "cara", availableFundsCents: 0 })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-cara",
        now: firstPromotionTime,
      });
    const participant = createTestUser({
      userId: "dana",
      availableFundsCents: 500,
    }).asParticipant();

    // Act
    const promotion = participant.promoteFromWaitlist(bookingSession, {
      holdId: "h-dana",
      now: nextPromotionTime,
    });

    // Assert
    expect(promotion.kind).toBe("PROMOTED");
    expect(promotion.participationId).toBe("p-dana");
    expect(promotion.instructions).toEqual([
      expect.objectContaining({
        kind: "LOCK",
        participationId: "p-dana",
        holdId: "h-dana",
      }),
    ]);
    expect(promotion.instructions[0]?.amount.toCents()).toBe(500);
    expect(
      bookingSession.participantList.requireParticipation("p-dana").status,
    ).toBe("COMMITTED");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "evan",
    );
  });

  test("promoteFromWaitlist_WhenParticipantChoosesOpenWaitlist_AdmitsFirstWaiterAndRefundsTheirShare", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(10);
    const promotionTime = hoursBeforeSessionStart(8);
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "evan"],
    });
    const owner = createTestUser({ userId: "ben" }).asParticipant();
    owner.withdraw(bookingSession, {
      participationId: "p-ben",
      now: withdrawalTime,
      replacementMode: "OPEN_SLOT",
    });
    const participant = createTestUser({ userId: "dana" }).asParticipant();
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const promotion = participant.promoteFromWaitlist(bookingSession, {
      holdId: "h-dana",
      now: promotionTime,
    });

    // Assert
    expect(promotion).toMatchObject({
      kind: "PROMOTED",
      participationId: "p-dana",
      refundedParticipationId: "p-ben",
    });
    expect(promotion.instructions).toEqual([
      expect.objectContaining({
        kind: "LOCK",
        participationId: "p-dana",
        holdId: "h-dana",
      }),
      expect.objectContaining({
        kind: "REFUND",
        participationId: "p-ben",
        holdId: "h-ben",
      }),
    ]);
    expect(
      promotion.instructions.map((instruction) => instruction.amount.toCents()),
    ).toEqual([500, 500]);
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold?.state,
    ).toBe("REFUNDED");
    expect(
      bookingSession.participantList.requireParticipation("p-dana").hold?.state,
    ).toBe("HELD");
    expect(
      bookingSession.participantList.requireParticipation("p-dana")
        .replacesParticipationId,
    ).toBe("p-ben");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "evan",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
  });

  test("promoteFromWaitlist_WhenTwoParticipantsChooseOpenWaitlist_RefundsEarlierWithdrawal", () => {
    // Arrange
    const benWithdrawalTime = hoursBeforeSessionStart(10);
    const aliceWithdrawalTime = hoursBeforeSessionStart(9);
    const promotionTime = hoursBeforeSessionStart(7);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana"],
    });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(bookingSession, {
      participationId: "p-ben",
      now: benWithdrawalTime,
      replacementMode: "OPEN_SLOT",
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: aliceWithdrawalTime,
        replacementMode: "OPEN_SLOT",
      });

    // Act
    const promotion = createTestUser({ userId: "dana" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-dana",
        now: promotionTime,
      });

    // Assert
    expect(promotion).toMatchObject({
      kind: "PROMOTED",
      refundedParticipationId: "p-ben",
      instructions: [
        { kind: "LOCK", participationId: "p-dana" },
        { kind: "REFUND", participationId: "p-ben" },
      ],
    });
    const ben = bookingSession.participantList.findByUserId("ben");
    const alice = bookingSession.participantList.findByUserId("alice");
    const dana = bookingSession.participantList.findByUserId("dana");
    expect(ben?.withdrawnAt).toEqual(benWithdrawalTime);
    expect(ben?.hold?.state).toBe("REFUNDED");
    expect(alice?.withdrawnAt).toEqual(aliceWithdrawalTime);
    expect(alice?.hold?.state).toBe("AWAITING_REPLACEMENT");
    expect(dana?.replacesParticipationId).toBe("p-ben");
  });
});
