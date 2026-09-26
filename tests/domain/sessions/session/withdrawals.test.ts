import { describe, expect, test } from "vitest";
import {
  at,
  before,
  destination,
  end,
  loadedUser,
  hour,
  join,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("withdrawParticipant_WhenOneMillisecondBeforeRefundCutoff_RefundsHold", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");

    // Act
    const withdrawal = bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(30 + 1 / hour),
    });

    // Assert
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(bookingSession.participations[0]?.hold?.state).toBe("REFUNDED");
  });

  test("withdrawParticipant_WhenExactlyAtRefundCutoff_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");

    // Act
    const withdrawal = bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(30),
    });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("withdrawParticipant_WhenOneHourBeforeStart_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");

    // Act
    const withdrawal = bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(1),
    });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("withdrawParticipant_WhenActorDoesNotOwnParticipation_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.withdrawParticipant({
        actorId: "other",
        participationId: "p-a",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdrawParticipant_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: start,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("join_WhenEntrantUsesNewerReplacementLink_RefundsOldestWithdrawal", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(20),
      replacementMode: "INVITE_LINK",
      replacementToken: "old",
    });
    bookingSession.withdrawParticipant({
      actorId: "b",
      participationId: "p-b",
      now: at(20),
      replacementMode: "INVITE_LINK",
      replacementToken: "new",
    });
    bookingSession.changeVisibility({
      actorId: "booker",
      visibility: "PRIVATE",
      now: at(19),
    });

    // Act
    const replacement = bookingSession.join(loadedUser("c"), {
      participationId: "p-c",
      holdId: "h-c",
      replacementToken: "new",
      now: at(19),
    });

    // Assert
    expect(replacement.refundedParticipationId).toBe("p-a");
    expect(replacement.instructions.map((i) => i.kind)).toEqual([
      "LOCK",
      "REFUND",
    ]);
    expect(
      bookingSession.participations.find((p) => p.userId === "b")?.hold?.state,
    ).toBe("AWAITING_REPLACEMENT");
  });

  test("join_WhenPersonalReplacementLinkWasUsedAndOrdinarySlotIsAvailable_RejectsWithoutChangingState", () => {
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
    const replacement = bookingSession.join(loadedUser("cara"), {
      participationId: "p-cara",
      holdId: "h-cara",
      replacementToken: "ben-replacement",
      now: at(9),
    });
    expect(replacement.kind).toBe("COMMITTED");
    expect(replacement.refundedParticipationId).toBe("p-ben");
    expect(bookingSession.getAvailableSlots(at(8))).toBe(1);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.join(loadedUser("evan"), {
        participationId: "p-evan",
        holdId: "h-evan",
        replacementToken: "ben-replacement",
        now: at(8),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_ACCESS",
        message: "The replacement link is invalid or no longer available",
      }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("join_WhenPersonalReplacementLinkWasUsedAndSessionIsFull_RejectsWithoutWaitlisting", () => {
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
    join(bookingSession, "dana", at(8));
    expect(bookingSession.getAvailableSlots(at(7))).toBe(0);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.join(loadedUser("evan"), {
        participationId: "p-evan",
        holdId: "h-evan",
        replacementToken: "ben-replacement",
        now: at(7),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("join_WhenParticipantWasRemoved_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    bookingSession.removeParticipant({
      actorId: "booker",
      participationId: "p-a",
      now: before,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => join(bookingSession, "a")).toThrow(
      expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenReplacementSweepWasMissed_ExpiresOutstandingReplacement", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });

    // Act
    bookingSession.expireReplacements(at(1));
    const batch = bookingSession.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    // Assert
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "FORFEITURE_DUE",
    );
    expect(batch?.lines).toMatchObject([{ kind: "FORFEIT" }]);
  });

  test("removeParticipant_WhenActorIsNotBooker_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.removeParticipant({
        actorId: "other",
        participationId: "p-a",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeParticipant_WhenBookerRemovesParticipant_RefundsHold", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");

    // Act
    const removal = bookingSession.removeParticipant({
      actorId: "booker",
      participationId: "p-a",
      now: before,
    });

    // Assert
    expect(removal.instructions[0]?.kind).toBe("REFUND");
  });

  test("cancel_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.cancel({ actorId: "booker", now: start }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("cancel_WhenRosterIncludesActiveWithdrawnAndWaitingParticipants_RefundsHoldsAndClearsQueue", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    join(bookingSession, "c");
    bookingSession.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(2),
    });

    // Act
    const cancellation = bookingSession.cancel({
      actorId: "booker",
      now: at(1),
    });

    // Assert
    expect(cancellation.instructions).toHaveLength(2);
    expect(cancellation.instructions.every((i) => i.kind === "REFUND")).toBe(
      true,
    );
    expect(bookingSession.status).toBe("CANCELLED");
    expect(bookingSession.nextWaitlistedUserId).toBeUndefined();
    expect(
      bookingSession.participations.every(
        (p) => !p.hold || p.hold.state === "REFUNDED",
      ),
    ).toBe(true);
  });
});
