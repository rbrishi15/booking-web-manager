import { describe, expect, test } from "vitest";
import {
  at,
  before,
  destination,
  end,
  join,
  loadedUser,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("prepareSettlement_WhenReplacementSweepWasMissed_ExpiresOutstandingReplacement", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    loadedUser("a")
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-a", now: at(2) });

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
    loadedUser("a")
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-a", now: at(2) });

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
