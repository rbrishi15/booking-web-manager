import { DomainError, Session } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import { fundedWallet } from "../../accounts/user-fixtures";
import {
  at,
  before,
  creationDetails,
  join,
  loadedUser,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  describe("Creation", () => {
    test("create_WhenBookerIsInactive_ThrowsInactiveAccount", () => {
      // Arrange
      const details = creationDetails();

      // Act & Assert
      expect(() =>
        Session.create({ ...details, bookerStatus: "INACTIVE" }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    });

    test("create_WhenPayoutAccountIsIncomplete_ThrowsPayoutAccountNotReady", () => {
      // Arrange
      const details = creationDetails();

      // Act & Assert
      expect(() => Session.create({ ...details, payoutReady: false })).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("create_WhenShareWouldBeZero_ThrowsInvalidInput", () => {
      // Arrange
      const details = creationDetails();

      // Act & Assert
      expect(() => Session.create({ ...details, totalSlots: 1001 })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("create_WhenMinimumHeadcountIsOne_ThrowsInvalidInput", () => {
      // Arrange
      const details = creationDetails();

      // Act & Assert
      expect(() => Session.create({ ...details, minimumHeadcount: 1 })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });
  });

  describe("Capacity", () => {
    test("admitParticipant_WhenEightSlotsFillIncludingBooker_WaitlistsNextApplicant", () => {
      // Arrange
      const bookingSession = session(8);

      // Act
      const commitments = ["booker", "a", "b", "c", "d", "e", "f", "g"].map(
        (id) =>
          bookingSession.admitParticipant(loadedUser(id).asParticipant(), {
            participationId: `p-${id}`,
            holdId: `h-${id}`,
            now: before,
          }).kind,
      );
      const availableSlots = bookingSession.getAvailableSlots(before);
      const waitingKind = bookingSession.admitParticipant(
        loadedUser("waiting").asParticipant(),
        { participationId: "p-waiting", holdId: "h-waiting", now: before },
      ).kind;

      // Assert
      expect(commitments).toEqual([
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
      ]);
      expect(availableSlots).toBe(0);
      expect(waitingKind).toBe("WAITLISTED");
    });
  });

  describe("Queue promotion", () => {
    test("promoteNext_WhenQueueIsEmpty_ReturnsNoneBeforeValidatingHoldId", () => {
      // Arrange
      const bookingSession = session();
      const previousState = sessionState(bookingSession);

      // Act
      const result = bookingSession.promoteNext(
        loadedUser("a").asParticipant(),
        {
          holdId: "",
          now: before,
        },
      );

      // Assert
      expect(result).toEqual({ kind: "NONE", instructions: [] });
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("promoteNext_WhenSessionHasStartedAndQueueIsEmpty_RejectsBeforeReturningNone", () => {
      // Arrange
      const bookingSession = session();
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.promoteNext(loadedUser("a").asParticipant(), {
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

    test("promoteNext_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      join(bookingSession, "first-waiter");
      join(bookingSession, "second-waiter");
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-a", now: at(2) });
      const previousState = sessionState(bookingSession);
      const awaiting = bookingSession.participations.find(
        (p) => p.participationId === "p-a",
      )!;
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
          bookingSession.promoteNext(
            loadedUser("first-waiter").asParticipant(),
            {
              holdId: "h-promoted",
              now: at(1),
            },
          ),
        ).toThrow(failure);
        expect(refund).toHaveBeenCalledOnce();
        expect(sessionState(bookingSession)).toEqual(previousState);
        expect(bookingSession.nextWaitlistedUserId).toBe("first-waiter");
      } finally {
        refund.mockRestore();
      }
    });

    test("promoteNext_WhenLoadedUserDoesNotMatchNextWaiter_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      const unfundedUser = loadedUser("c", { wallet: fundedWallet("c", 0) });
      unfundedUser.asParticipant().join(bookingSession, {
        participationId: "p-c",
        now: before,
      });
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-a", now: before });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.promoteNext(loadedUser("other").asParticipant(), {
          holdId: "h-c",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("promoteNext_WhenReloadedWaiterHasFunds_PromotesFromUpdatedWallet", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      const unfundedUser = loadedUser("c", { wallet: fundedWallet("c", 0) });
      const waitlistAdmission = unfundedUser
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-c",
          now: before,
        });
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-a", now: before });
      const reloadedUser = loadedUser("c", { wallet: fundedWallet("c", 500) });

      // Act
      const promotion = bookingSession.promoteNext(
        reloadedUser.asParticipant(),
        {
          holdId: "h-c",
          now: before,
        },
      );

      // Assert
      expect(waitlistAdmission.kind).toBe("WAITLISTED");
      expect(promotion.kind).toBe("PROMOTED");
      expect(promotion.instructions[0]?.walletId).toBe("w-c");
      expect(unfundedUser.wallet.getFunds().toCents()).toBe(0);
      expect(reloadedUser.wallet.getFunds().toCents()).toBe(500);
    });

    test("promoteNext_WhenWaitersTieAndFirstCannotPay_PreservesQueuePriority", () => {
      // Arrange
      const bookingSession = session();

      // Act
      join(bookingSession, "a");
      join(bookingSession, "b");
      const waitlistAdmission = loadedUser("c", {
        wallet: fundedWallet("c", 0),
      })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-c",
          holdId: "h-c",
          now: before,
        });
      join(bookingSession, "d");
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-a", now: before });
      const freshAdmission = join(bookingSession, "fresh");
      const firstPromotion = bookingSession.promoteNext(
        loadedUser("c", {
          wallet: fundedWallet("c", 0),
        }).asParticipant(),
        {
          holdId: "h-c",
          now: before,
        },
      );
      const nextWaiterAfterSkip = bookingSession.nextWaitlistedUserId;
      const secondPromotion = bookingSession.promoteNext(
        loadedUser("d").asParticipant(),
        {
          holdId: "h-d",
          now: before,
        },
      );

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
      expect(nextWaiterAfterSkip).toBe("d");
      expect(secondPromotion.kind).toBe("PROMOTED");
      expect(bookingSession.nextWaitlistedUserId).toBe("fresh");
    });
  });

  describe("Availability", () => {
    test("getAvailableSlots_WhenSessionStartsNow_ReturnsZero", () => {
      // Arrange
      const bookingSession = session();

      // Act
      const availableSlots = bookingSession.getAvailableSlots(start);

      // Assert
      expect(availableSlots).toBe(0);
    });
  });
});
