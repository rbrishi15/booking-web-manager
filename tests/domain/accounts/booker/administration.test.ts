import { DomainError, Session } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  withdrawnParticipation,
  createTestUser,
  readyBooker,
  createTestSession,
  sessionDetails,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Booker administration", () => {
  describe("Session cancellation", () => {
    test("cancel_WhenOwnerCancelsEmptySession_ReturnsNoInstructions", () => {
      const cancellationTime = hoursBeforeSessionStart(48);
      const booker = readyBooker();
      const session = createTestSession();

      const cancellation = booker.cancel(session, cancellationTime);

      expect(session.bookerId).toBe(booker.userId);
      expect(session.status).toBe("CANCELLED");
      expect(cancellation.instructions).toEqual([]);
    });

    test("assertCanCancel_WhenOwnerIsUnverified_AllowsExitWithoutChangingSession", () => {
      const cancellationTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const booker = createTestUser({
        userId: "booker",
        emailVerified: false,
      }).asBooker();
      const previousState = sessionState(bookingSession);

      booker.assertCanCancel(bookingSession, cancellationTime);

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("assertCanCancel_WhenSessionHasStarted_ReportsCommandLifecycleFailure", () => {
      const bookingSession = createTestSession();
      const previousState = sessionState(bookingSession);

      expect(() =>
        readyBooker().assertCanCancel(bookingSession, sessionStartsAt),
      ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("cancel_WhenSecondChildFails_PreservesParticipantsHoldsAndStatus", () => {
      const cancellationTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["waiting"],
      });
      const booker = readyBooker();
      const previousState = sessionState(bookingSession);

      // Simulate Ben's cancellation failing after Alice has been processed.
      const cancelBen = vi
        .spyOn(
          bookingSession.participantList.requireParticipation("p-ben"),
          "cancel",
        )
        .mockImplementationOnce(() => {
          throw new DomainError("INVALID_STATE", "Second cancellation failed");
        });

      try {
        expect(() => booker.cancel(bookingSession, cancellationTime)).toThrow(
          expect.objectContaining({
            code: "INVALID_STATE",
            message: "Second cancellation failed",
          }),
        );

        expect(sessionState(bookingSession)).toEqual(previousState);
      } finally {
        cancelBen.mockRestore();
      }
    });

    test("cancel_WhenPreviousChildFailureWasResolved_CancelsAndRefunds", () => {
      const cancellationTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["waiting"],
      });
      const booker = readyBooker();

      // Simulate a failed first cancellation before exercising the retry.
      const cancelBen = vi
        .spyOn(
          bookingSession.participantList.requireParticipation("p-ben"),
          "cancel",
        )
        .mockImplementationOnce(() => {
          throw new DomainError("INVALID_STATE", "Second cancellation failed");
        });

      // Establish a rejected cancellation before exercising the retry.
      try {
        expect(() => booker.cancel(bookingSession, cancellationTime)).toThrow(
          expect.objectContaining({
            code: "INVALID_STATE",
            message: "Second cancellation failed",
          }),
        );
      } finally {
        cancelBen.mockRestore();
      }

      const cancellation = booker.cancel(bookingSession, cancellationTime);

      expect(
        cancellation.instructions.map((instruction) => instruction.kind),
      ).toEqual(["REFUND", "REFUND"]);
      expect(bookingSession.status).toBe("CANCELLED");
      expect(
        bookingSession.participantList.participations.map(
          (participation) => participation.status,
        ),
      ).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    });

    test("cancel_WhenOwnerIsInactive_StillCancelsAndRefunds", () => {
      const cancellationTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const booker = createTestUser({
        userId: "booker",
        accountStatus: "INACTIVE",
      }).asBooker();

      const cancellation = booker.cancel(bookingSession, cancellationTime);

      expect(bookingSession.status).toBe("CANCELLED");
      expect(cancellation.instructions[0]?.kind).toBe("REFUND");
    });

    test("cancel_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      expect(() => readyBooker().cancel(bookingSession, sessionStartsAt)).toThrow(
        expect.objectContaining({ code: "SESSION_STARTED" }),
      );

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("cancel_WhenRosterIncludesActiveWithdrawnAndWaitingParticipants_RefundsHoldsAndClearsQueue", () => {
      const withdrawalTime = hoursBeforeSessionStart(2);
      const cancellationTime = hoursBeforeSessionStart(1);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: withdrawalTime,
            replacementMode: "OPEN_SLOT",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });

      const cancellation = readyBooker().cancel(bookingSession, cancellationTime);

      expect(cancellation.instructions).toHaveLength(2);
      expect(
        cancellation.instructions.map((instruction) => instruction.kind),
      ).toEqual(["REFUND", "REFUND"]);
      expect(bookingSession.status).toBe("CANCELLED");
      expect(
        bookingSession.participantList.nextWaitlisted()?.userId,
      ).toBeUndefined();
      expect(
        bookingSession.participantList.participations.map(
          (participation) => participation.hold?.state,
        ),
      ).toEqual(["REFUNDED", "REFUNDED", undefined]);
    });
  });

  describe("Session visibility", () => {
    test("assertCanChangeVisibility_WhenOwnerIsUnverified_DoesNotChangeVisibility", () => {
      const bookingSession = createTestSession();
      const booker = createTestUser({
        userId: "booker",
        emailVerified: false,
      }).asBooker();
      const previousState = sessionState(bookingSession);

      booker.assertCanChangeVisibility(
        bookingSession,
        "PRIVATE",
        hoursBeforeSessionStart(48),
      );

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("assertCanChangeVisibility_WhenSessionIsFull_ReportsCommandCapacityFailure", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        readyBooker().assertCanChangeVisibility(
          bookingSession,
          "PRIVATE",
          hoursBeforeSessionStart(48),
        ),
      ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("changeVisibility_WhenOwnerIsUnverified_ChangesPublicSessionToPrivate", () => {
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const bookingSession = new Session(
        sessionDetails({ visibility: "PUBLIC" }),
      );
      const booker = createTestUser({
        userId: "booker",
        emailVerified: false,
      }).asBooker();

      booker.changeVisibility(bookingSession, "PRIVATE", visibilityChangeTime);

      expect(bookingSession.visibility).toBe("PRIVATE");
    });

    test("changeVisibility_WhenOwnerIsInactive_StillChangesVisibility", () => {
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession();
      const booker = createTestUser({
        userId: "booker",
        accountStatus: "INACTIVE",
      }).asBooker();

      booker.changeVisibility(bookingSession, "PRIVATE", visibilityChangeTime);

      expect(bookingSession.visibility).toBe("PRIVATE");
    });

    test("changeVisibility_WhenSessionIsFull_RejectsWithoutChangingState", () => {
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        readyBooker().changeVisibility(
          bookingSession,
          "PRIVATE",
          visibilityChangeTime,
        ),
      ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });

  describe("Participant removal", () => {
    test("removeParticipant_WhenOwnerIsInactive_StillRemovesAndRefunds", () => {
      const removalTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const booker = createTestUser({
        userId: "booker",
        accountStatus: "INACTIVE",
      }).asBooker();

      const removal = booker.removeParticipant(
        bookingSession,
        "p-alice",
        removalTime,
      );
      const aliceParticipation =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(aliceParticipation.status).toBe("REMOVED");
      expect(aliceParticipation.hold?.state).toBe("REFUNDED");
      expect(removal.instructions[0]?.kind).toBe("REFUND");
    });

    test("removeParticipant_WhenActorIsNotBooker_RejectsWithoutChangingState", () => {
      const removalTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

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
      const removalTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const removal = readyBooker().removeParticipant(
        bookingSession,
        "p-alice",
        removalTime,
      );

      const removed =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(removal.instructions).toEqual([
        expect.objectContaining({
          kind: "REFUND",
          participationId: "p-alice",
          holdId: "h-alice",
          walletId: "w-alice",
        }),
      ]);
      expect(removal.instructions[0]?.amount.toCents()).toBe(500);
      expect(removed.status).toBe("REMOVED");
      expect(removed.hold?.state).toBe("REFUNDED");
    });
  });

  describe("Forfeited places", () => {
    test("cancel_WhenAPlaceWasForfeited_RefundsTheForfeitedShare", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["ben"],
        participationOverrides: {
          ben: withdrawnParticipation("ben", {
            withdrawnAt: hoursBeforeSessionStart(10),
            replacementMode: "FORFEIT",
            holdState: "FORFEITURE_DUE",
          }),
        },
      });

      const cancellation = readyBooker().cancel(bookingSession, hoursBeforeSessionStart(5));

      const ben = bookingSession.participantList.requireParticipation("p-ben");
      expect(cancellation.instructions.map((instruction) => instruction.kind)).toEqual(["REFUND"]);
      expect(cancellation.instructions[0]?.amount.toCents()).toBe(500);
      expect(ben.status).toBe("CANCELLED");
      expect(ben.hold?.state).toBe("REFUNDED");
    });
  });
});
