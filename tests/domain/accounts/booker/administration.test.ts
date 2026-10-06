import { DomainError } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestUser,
  readyBooker,
  createTestSession,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("assertCanCancel_WhenOwnerIsUnverified_AllowsExitWithoutChangingSession", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const booker = createTestUser({ userId: "booker", emailVerified: false }).asBooker();
    const previousState = sessionState(bookingSession);

    // Act
    booker.assertCanCancel(bookingSession, hoursBeforeSessionStart(48));

    // Assert
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("assertCanCancel_WhenSessionHasStarted_ReportsCommandLifecycleFailure", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => readyBooker().assertCanCancel(bookingSession, sessionStartsAt)).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("assertCanChangeVisibility_WhenOwnerIsUnverified_DoesNotChangeVisibility", () => {
    // Arrange
    const bookingSession = createTestSession();
    const booker = createTestUser({ userId: "booker", emailVerified: false }).asBooker();
    const previousState = sessionState(bookingSession);

    // Act
    booker.assertCanChangeVisibility(bookingSession, "PRIVATE", hoursBeforeSessionStart(48));

    // Assert
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("assertCanChangeVisibility_WhenSessionIsFull_ReportsCommandCapacityFailure", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice", "ben"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => readyBooker().assertCanChangeVisibility(
      bookingSession, "PRIVATE", hoursBeforeSessionStart(48),
    )).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("cancel_WhenSecondChildFails_PreservesParticipantsHoldsAndStatus", () => {
    // Arrange
    const cancellationTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const booker = readyBooker();
    const previousState = sessionState(bookingSession);
    const failure = new DomainError(
      "INVALID_STATE",
      "Second cancellation failed",
    );
    const cancellation = vi
      .spyOn(
        bookingSession.participantList.requireParticipation("p-ben"),
        "cancel",
      )
      .mockImplementationOnce(() => {
        throw failure;
      });

    try {
      // Act & Assert
      expect(() => booker.cancel(bookingSession, cancellationTime)).toThrow(
        failure,
      );
      expect(cancellation).toHaveBeenCalledOnce();
      expect(sessionState(bookingSession)).toEqual(previousState);
    } finally {
      cancellation.mockRestore();
    }
  });

  test("cancel_WhenPreviousChildFailureWasResolved_CancelsAndRefunds", () => {
    // Arrange
    const cancellationTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const booker = readyBooker();
    const failure = new DomainError(
      "INVALID_STATE",
      "Second cancellation failed",
    );
    const cancellation = vi
      .spyOn(
        bookingSession.participantList.requireParticipation("p-ben"),
        "cancel",
      )
      .mockImplementationOnce(() => {
        throw failure;
      });

    // Establish a rejected cancellation before exercising the retry.
    try {
      expect(() => booker.cancel(bookingSession, cancellationTime)).toThrow(
        failure,
      );
    } finally {
      cancellation.mockRestore();
    }

    // Act
    const result = booker.cancel(bookingSession, cancellationTime);

    // Assert
    expect(result.instructions.map((instruction) => instruction.kind)).toEqual([
      "REFUND",
      "REFUND",
    ]);
    expect(bookingSession.status).toBe("CANCELLED");
    expect(
      bookingSession.participantList.participations.every(
        (participation) => participation.status === "CANCELLED",
      ),
    ).toBe(true);
  });

  test("cancel_WhenOwnerIsInactive_StillCancelsAndRefunds", () => {
    // Arrange
    const cancellationTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const booker = createTestUser({
      userId: "booker",
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    const result = booker.cancel(bookingSession, cancellationTime);

    // Assert
    expect(bookingSession.status).toBe("CANCELLED");
    expect(result.instructions[0]?.kind).toBe("REFUND");
  });

  test("changeVisibility_WhenOwnerIsInactive_StillChangesVisibility", () => {
    // Arrange
    const visibilityChangeTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession();
    const booker = createTestUser({
      userId: "booker",
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    booker.changeVisibility(bookingSession, "PRIVATE", visibilityChangeTime);

    // Assert
    expect(bookingSession.visibility).toBe("PRIVATE");
  });

  test("changeVisibility_WhenSessionIsFull_RejectsWithoutChangingState", () => {
    // Arrange
    const visibilityChangeTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().changeVisibility(
        bookingSession,
        "PRIVATE",
        visibilityChangeTime,
      ),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeParticipant_WhenOwnerIsInactive_StillRemovesAndRefunds", () => {
    // Arrange
    const removalTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const booker = createTestUser({
      userId: "booker",
      accountStatus: "INACTIVE",
    }).asBooker();

    // Act
    const result = booker.removeParticipant(
      bookingSession,
      "p-alice",
      removalTime,
    );

    // Assert
    expect(
      bookingSession.participantList.requireParticipation("p-alice").status,
    ).toBe("REMOVED");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("REFUNDED");
    expect(result.instructions[0]?.kind).toBe("REFUND");
  });

  test("removeParticipant_WhenActorIsNotBooker_RejectsWithoutChangingState", () => {
    // Arrange
    const removalTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("other").removeParticipant(
        bookingSession,
        "p-alice",
        removalTime,
      ),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeParticipant_WhenBookerRemovesParticipant_RefundsHold", () => {
    // Arrange
    const removalTime = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const removal = readyBooker().removeParticipant(
      bookingSession,
      "p-alice",
      removalTime,
    );

    // Assert
    expect(removal.instructions).toEqual([
      expect.objectContaining({
        kind: "REFUND",
        participationId: "p-alice",
        holdId: "h-alice",
        walletId: "w-alice",
      }),
    ]);
    expect(removal.instructions[0]?.amount.toCents()).toBe(500);
    const removed =
      bookingSession.participantList.requireParticipation("p-alice");
    expect(removed.status).toBe("REMOVED");
    expect(removed.hold?.state).toBe("REFUNDED");
  });

  test("cancel_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => readyBooker().cancel(bookingSession, sessionStartsAt)).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("cancel_WhenRosterIncludesActiveWithdrawnAndWaitingParticipants_RefundsHoldsAndClearsQueue", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const cancellationTime = hoursBeforeSessionStart(1);
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

    // Act
    const cancellation = readyBooker().cancel(bookingSession, cancellationTime);

    // Assert
    expect(cancellation.instructions).toHaveLength(2);
    expect(cancellation.instructions.every((i) => i.kind === "REFUND")).toBe(
      true,
    );
    expect(bookingSession.status).toBe("CANCELLED");
    expect(
      bookingSession.participantList.nextWaitlisted()?.userId,
    ).toBeUndefined();
    expect(
      bookingSession.participantList.participations.every(
        (p) => !p.hold || p.hold.state === "REFUNDED",
      ),
    ).toBe(true);
  });
});
