import { describe, expect, test } from "vitest";
import {
  at,
  createTestUser,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("offerReplacementToWaitlist_WhenOwnerReleasesPersonalPlace_RefundsOnlyAfterFundedPromotion", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "evan"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const heldShare =
      bookingSession.participantList.requireParticipation("p-ben").hold;
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const offer = createTestUser({ userId: "ben" })
      .asParticipant()
      .offerReplacementToWaitlist(bookingSession, {
        participationId: "p-ben",
        now: at(9),
      });

    // Assert
    expect(offer.instructions).toEqual([]);
    expect(
      bookingSession.participantList.requireParticipation("p-ben").status,
    ).toBe("WITHDRAWN");
    expect(
      bookingSession.participantList.requireParticipation("p-ben")
        .replacementMode,
    ).toBe("OPEN_SLOT");
    expect(
      bookingSession.participantList.requireParticipation("p-ben")
        .replacementToken,
    ).toBeUndefined();
    expect(
      bookingSession.participantList.requireParticipation("p-ben").withdrawnAt,
    ).toEqual(at(10));
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold,
    ).toBe(heldShare);
    expect(heldShare?.state).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );

    // Act & Assert: the old personal link cannot admit or queue another person.
    const releasedState = sessionState(bookingSession);
    expect(() =>
      createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          replacementToken: "ben-replacement",
          now: at(8),
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
    expect(sessionState(bookingSession)).toEqual(releasedState);

    // Act: the first waiter successfully funds the replacement.
    const promotion = createTestUser({ userId: "dana" })
      .asParticipant()
      .promoteFromWaitlist(bookingSession, {
        holdId: "h-dana",
        now: at(8),
      });

    // Assert
    expect(promotion).toMatchObject({
      kind: "PROMOTED",
      participationId: "p-dana",
      refundedParticipationId: "p-ben",
    });
    expect(
      promotion.instructions.map((instruction) => instruction.kind),
    ).toEqual(["LOCK", "REFUND"]);
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

  test("offerReplacementToWaitlist_WhenOwnerWithdrewBeforeOpenSlotParticipant_PreservesOriginalRefundPriority", () => {
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

    // Act
    createTestUser({ userId: "ben" })
      .asParticipant()
      .offerReplacementToWaitlist(bookingSession, {
        participationId: "p-ben",
        now: at(8),
      });
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

  test("offerReplacementToWaitlist_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "booker" })
        .asParticipant()
        .offerReplacementToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: at(9),
        }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerReplacementToWaitlist_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "ben" })
        .asParticipant()
        .offerReplacementToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: start,
        }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerReplacementToWaitlist_WhenPersonalReplacementAlreadyJoined_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    createTestUser({ userId: "cara" })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        replacementToken: "ben-replacement",
        now: at(9),
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "ben" })
        .asParticipant()
        .offerReplacementToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: at(8),
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
