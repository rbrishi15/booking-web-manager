import { describe, expect, test } from "vitest";
import {
  at,
  join,
  loadedUser,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("offerReplacementToWaitlist_WhenOwnerReleasesPersonalPlace_RefundsOnlyAfterFundedPromotion", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "ben");
    join(bookingSession, "alex");
    join(bookingSession, "dana");
    join(bookingSession, "evan");
    bookingSession.withdrawParticipant({
      actorId: "ben",
      participationId: "p-ben",
      now: at(10),
      replacementMode: "INVITE_LINK",
      replacementToken: "ben-replacement",
    });
    const heldShare = bookingSession.participations[0]?.hold;
    const queueSequence = bookingSession.nextQueueSequence;

    // Act
    const offer = bookingSession.offerReplacementToWaitlist({
      actorId: "ben",
      participationId: "p-ben",
      now: at(9),
    });

    // Assert
    expect(offer.instructions).toEqual([]);
    expect(bookingSession.participations[0]?.status).toBe("WITHDRAWN");
    expect(bookingSession.participations[0]?.replacementMode).toBe("OPEN_SLOT");
    expect(bookingSession.participations[0]?.replacementToken).toBeUndefined();
    expect(bookingSession.participations[0]?.withdrawnAt).toEqual(at(10));
    expect(bookingSession.participations[0]?.hold).toBe(heldShare);
    expect(heldShare?.state).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.nextWaitlistedUserId).toBe("dana");
    expect(bookingSession.nextQueueSequence).toBe(queueSequence);

    // Act & Assert: the old personal link cannot admit or queue another person.
    const releasedState = sessionState(bookingSession);
    expect(() =>
      bookingSession.join(loadedUser("cara"), {
        participationId: "p-cara",
        holdId: "h-cara",
        replacementToken: "ben-replacement",
        now: at(8),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
    expect(sessionState(bookingSession)).toEqual(releasedState);

    // Act: the first waiter successfully funds the replacement.
    const promotion = bookingSession.promoteNext(loadedUser("dana"), {
      holdId: "h-dana",
      now: at(8),
    });

    // Assert
    expect(promotion).toMatchObject({
      kind: "PROMOTED",
      participationId: "p-dana",
      refundedParticipationId: "p-ben",
    });
    expect(promotion.instructions.map((instruction) => instruction.kind)).toEqual([
      "LOCK",
      "REFUND",
    ]);
    expect(bookingSession.participations[0]?.hold?.state).toBe("REFUNDED");
    expect(bookingSession.participations[2]?.hold?.state).toBe("HELD");
    expect(bookingSession.nextWaitlistedUserId).toBe("evan");
    expect(bookingSession.nextQueueSequence).toBe(queueSequence);
  });

  test("offerReplacementToWaitlist_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "ben");
    bookingSession.withdrawParticipant({
      actorId: "ben",
      participationId: "p-ben",
      now: at(10),
      replacementMode: "INVITE_LINK",
      replacementToken: "ben-replacement",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.offerReplacementToWaitlist({
        actorId: "booker",
        participationId: "p-ben",
        now: at(9),
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerReplacementToWaitlist_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "ben");
    bookingSession.withdrawParticipant({
      actorId: "ben",
      participationId: "p-ben",
      now: at(10),
      replacementMode: "INVITE_LINK",
      replacementToken: "ben-replacement",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.offerReplacementToWaitlist({
        actorId: "ben",
        participationId: "p-ben",
        now: start,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerReplacementToWaitlist_WhenPersonalReplacementAlreadyJoined_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "ben");
    bookingSession.withdrawParticipant({
      actorId: "ben",
      participationId: "p-ben",
      now: at(10),
      replacementMode: "INVITE_LINK",
      replacementToken: "ben-replacement",
    });
    bookingSession.join(loadedUser("cara"), {
      participationId: "p-cara",
      holdId: "h-cara",
      replacementToken: "ben-replacement",
      now: at(9),
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.offerReplacementToWaitlist({
        actorId: "ben",
        participationId: "p-ben",
        now: at(8),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
