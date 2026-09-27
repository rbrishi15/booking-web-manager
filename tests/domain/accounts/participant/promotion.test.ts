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
    expect(unfundedUser.wallet.getAvailableBalance().toCents()).toBe(0);
    expect(reloadedUser.wallet.getAvailableBalance().toCents()).toBe(500);
  });

  test("promoteFromWaitlist_WhenFirstWaiterCannotPay_SkipsThemAndSelectsNextWaiter", () => {
    // Arrange
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
      now: before,
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
    expect(bookingSession.getAvailableSlots(before)).toBe(1);
  });

  test("promoteFromWaitlist_WhenFirstTiedWaiterWasSkipped_PromotesNextWaiter", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben"],
      waitlistedUserIds: ["cara", "dana", "evan"],
    });
    createTestUser({ userId: "cara", availableFundsCents: 0 })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-cara",
        now: before,
      });
    const participant = createTestUser({
      userId: "dana",
      availableFundsCents: 500,
    }).asParticipant();

    // Act
    const promotion = participant.promoteFromWaitlist(bookingSession, {
      holdId: "h-dana",
      now: before,
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

  test("promoteFromWaitlist_WhenPersonalPlaceWasOfferedToWaitlist_RefundsWithdrawnParticipant", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "evan"],
    });
    const owner = createTestUser({ userId: "ben" }).asParticipant();
    owner.withdraw(bookingSession, {
      participationId: "p-ben",
      now: at(10),
      replacementMode: "INVITE_LINK",
      replacementToken: "ben-replacement",
    });
    owner.offerPlaceToWaitlist(bookingSession, {
      participationId: "p-ben",
      now: at(9),
    });
    const participant = createTestUser({ userId: "dana" }).asParticipant();
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const promotion = participant.promoteFromWaitlist(bookingSession, {
      holdId: "h-dana",
      now: at(8),
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
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "evan",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
  });

  test("promoteFromWaitlist_WhenPersonalPlaceWasOfferedAfterLaterWithdrawal_RefundsEarlierWithdrawal", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(9),
        replacementMode: "OPEN_SLOT",
      });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .offerPlaceToWaitlist(bookingSession, {
        participationId: "p-ben",
        now: at(8),
      });

    // Act
    const promotion = createTestUser({ userId: "dana" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-dana",
        now: at(7),
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
    expect(ben?.withdrawnAt).toEqual(at(10));
    expect(ben?.hold?.state).toBe("REFUNDED");
    expect(alice?.withdrawnAt).toEqual(at(9));
    expect(alice?.hold?.state).toBe("AWAITING_REPLACEMENT");
    expect(dana?.replacesParticipationId).toBe("p-ben");
  });
});
