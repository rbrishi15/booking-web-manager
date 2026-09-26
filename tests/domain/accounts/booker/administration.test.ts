import { DomainError } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  at,
  before,
  join,
  loadedUser,
  readyBooker,
  session,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenSecondChildFails_PreservesRosterHoldsAndStatusAndAllowsRetry", () => {
    // Arrange
    const bookingSession = session();
    const booker = readyBooker();
    join(bookingSession, "a");
    join(bookingSession, "b");
    join(bookingSession, "waiting");
    const previousState = sessionState(bookingSession);
    const failure = new DomainError(
      "INVALID_STATE",
      "Second cancellation failed",
    );
    const cancellation = vi
      .spyOn(bookingSession.participations[1]!, "cancel")
      .mockImplementationOnce(() => {
        throw failure;
      });

    try {
      // Act & Assert
      expect(() => booker.cancel(bookingSession, before)).toThrow(failure);
      expect(cancellation).toHaveBeenCalledOnce();
      expect(sessionState(bookingSession)).toEqual(previousState);
    } finally {
      cancellation.mockRestore();
    }

    // Act
    const result = booker.cancel(bookingSession, before);

    // Assert
    expect(result.instructions.map((instruction) => instruction.kind)).toEqual([
      "REFUND",
      "REFUND",
    ]);
    expect(bookingSession.status).toBe("CANCELLED");
    expect(
      bookingSession.participations.every(
        (participation) => participation.status === "CANCELLED",
      ),
    ).toBe(true);
  });

  test("cancel_WhenOwnerIsInactive_StillCancelsAndRefunds", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const booker = loadedUser("booker", {
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    const result = booker.cancel(bookingSession, before);

    // Assert
    expect(bookingSession.status).toBe("CANCELLED");
    expect(result.instructions[0]?.kind).toBe("REFUND");
  });

  test("changeVisibility_WhenOwnerIsInactive_StillChangesVisibility", () => {
    // Arrange
    const bookingSession = session();
    const booker = loadedUser("booker", {
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    booker.changeVisibility(bookingSession, "PRIVATE", before);

    // Assert
    expect(bookingSession.visibility).toBe("PRIVATE");
  });

  test("changeVisibility_WhenSessionIsFull_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().changeVisibility(bookingSession, "PRIVATE", before),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeParticipant_WhenOwnerIsInactive_StillRemovesAndRefunds", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const booker = loadedUser("booker", {
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    const result = booker.removeParticipant(bookingSession, "p-a", before);

    // Assert
    expect(bookingSession.participations[0]?.status).toBe("REMOVED");
    expect(bookingSession.participations[0]?.hold?.state).toBe("REFUNDED");
    expect(result.instructions[0]?.kind).toBe("REFUND");
  });

  test("removeParticipant_WhenActorIsNotBooker_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").removeParticipant(bookingSession, "p-a", before),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeParticipant_WhenBookerRemovesParticipant_RefundsHold", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");

    // Act
    const removal = readyBooker().removeParticipant(
      bookingSession,
      "p-a",
      before,
    );

    // Assert
    expect(removal.instructions[0]?.kind).toBe("REFUND");
  });

  test("cancel_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => readyBooker().cancel(bookingSession, start)).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
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
    const cancellation = readyBooker().cancel(bookingSession, at(1));

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
