import {
  DomainError,
  LedgerTransaction,
  Money,
  ReliabilityScore,
  Session,
  Wallet,
} from "@/domain";
import { describe, expect, test, vi } from "vitest";
import { fundedWallet } from "../../accounts/user-fixtures";
import {
  at,
  before,
  creationDetails,
  loadedUser,
  join,
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

  describe("Admission and reentry", () => {
    test("join_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      join(bookingSession, "former-waiter");
      bookingSession.leaveWaitlist({
        actorId: "former-waiter",
        participationId: "p-former-waiter",
        now: before,
      });
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: at(2),
      });
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
        expect(() => join(bookingSession, "replacement", at(1))).toThrow(
          failure,
        );
        expect(refund).toHaveBeenCalledOnce();
        expect(sessionState(bookingSession)).toEqual(previousState);
      } finally {
        refund.mockRestore();
      }
    });

    test("join_WhenFundsExactlyCoverShare_CommitsAndEmitsLock", () => {
      // Arrange
      const bookingSession = session();
      const fundedUser = loadedUser("u", { wallet: fundedWallet("u", 500) });

      // Act
      const admission = bookingSession.join(fundedUser, {
        participationId: "p-u",
        holdId: "h-u",
        now: before,
      });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
      expect(admission.instructions[0]?.amount.toCents()).toBe(500);
    });

    test("join_WhenReloadedWalletIncludesPriorLock_RejectsWithoutChangingState", () => {
      // Arrange
      const fundedUser = loadedUser("u", { wallet: fundedWallet("u", 500) });
      const command = { participationId: "p-u", holdId: "h-u", now: before };
      session().join(fundedUser, command);
      const reloadedUser = loadedUser("u", {
        wallet: new Wallet({
          walletId: fundedUser.wallet.walletId,
          userId: fundedUser.userId,
          transactions: [
            ...fundedUser.wallet.transactions,
            new LedgerTransaction({
              transactionId: "lock-u",
              walletId: fundedUser.wallet.walletId,
              kind: "LOCK",
              amount: Money.fromCents(500),
              occurredAt: before,
              idempotencyKey: "lock-u",
              holdId: "h-u",
            }),
          ],
        }),
      });
      const nextSession = session();
      const previousState = sessionState(nextSession);

      // Act & Assert
      expect(() => nextSession.join(reloadedUser, command)).toThrow(
        expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }),
      );
      expect(sessionState(nextSession)).toEqual(previousState);
      expect(fundedUser.wallet.getFunds().toCents()).toBe(500);
      expect(reloadedUser.wallet.getFunds().toCents()).toBe(0);
    });

    test("join_WhenUserIsNotInInvitedGroup_RejectsWithoutChangingState", () => {
      // Arrange
      const privateSession = Session.create({
        ...creationDetails(),
        visibility: "PRIVATE",
        invitedGroupId: "group",
        minimumReliability: ReliabilityScore.from(80),
      });
      const command = { participationId: "p-u", holdId: "h-u", now: before };
      const applicant = loadedUser("u");
      const previousState = sessionState(privateSession);

      // Act & Assert
      expect(() => privateSession.join(applicant, command)).toThrow(
        expect.objectContaining({ code: "INVALID_ACCESS" }),
      );
      expect(sessionState(privateSession)).toEqual(previousState);
    });

    test("join_WhenMemberIsBelowReliabilityThreshold_RejectsWithoutChangingState", () => {
      // Arrange
      const privateSession = Session.create({
        ...creationDetails(),
        visibility: "PRIVATE",
        invitedGroupId: "group",
        minimumReliability: ReliabilityScore.from(80),
      });
      const command = { participationId: "p-u", holdId: "h-u", now: before };
      const applicant = loadedUser("u", {
        memberGroupIds: ["group"],
        reliabilityScore: ReliabilityScore.from(79),
      });
      const previousState = sessionState(privateSession);

      // Act & Assert
      expect(() =>
        applicant.asParticipant().join(privateSession, command),
      ).toThrow(expect.objectContaining({ code: "LOW_RELIABILITY" }));
      expect(sessionState(privateSession)).toEqual(previousState);
    });

    test("join_WhenInvitedMemberMeetsReliabilityThreshold_CommitsFromLoadedWallet", () => {
      // Arrange
      const privateSession = Session.create({
        ...creationDetails(),
        visibility: "PRIVATE",
        invitedGroupId: "group",
        minimumReliability: ReliabilityScore.from(80),
      });
      const eligibleUser = loadedUser("u", {
        memberGroupIds: ["group"],
        reliabilityScore: ReliabilityScore.from(80),
      });

      // Act
      const admission = eligibleUser.asParticipant().join(privateSession, {
        participationId: "p-u",
        holdId: "h-u",
        now: before,
      });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
      expect(admission.instructions[0]?.walletId).toBe(
        eligibleUser.wallet.walletId,
      );
    });

    test("join_WhenEightSlotsFillIncludingBooker_WaitlistsNextApplicant", () => {
      // Arrange
      const bookingSession = session(8);

      // Act
      const commitments = ["booker", "a", "b", "c", "d", "e", "f", "g"].map(
        (id) => join(bookingSession, id).kind,
      );
      const availableSlots = bookingSession.getAvailableSlots(before);
      const waitingKind = join(bookingSession, "waiting").kind;

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

    test("join_WhenUserIsInactive_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      const applicant = loadedUser("u", { accountStatus: "INACTIVE" });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.join(applicant, {
          participationId: "p",
          holdId: "h",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenFundsAreOneCentBelowShare_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      const applicant = loadedUser("u", { wallet: fundedWallet("u", 499) });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.join(applicant, {
          participationId: "p",
          holdId: "h",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenPrivateRoomTokenIsMissing_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      bookingSession.changeVisibility({
        actorId: "booker",
        visibility: "PRIVATE",
        now: before,
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => join(bookingSession, "u")).toThrow(
        expect.objectContaining({
          code: "INVALID_ACCESS",
          message: "The user does not have access to this private session",
        }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenPrivateRoomTokenMatches_CommitsApplicant", () => {
      // Arrange
      const bookingSession = session();
      bookingSession.changeVisibility({
        actorId: "booker",
        visibility: "PRIVATE",
        now: before,
      });

      // Act
      const admission = bookingSession.join(loadedUser("u"), {
        participationId: "p",
        holdId: "h",
        now: before,
        roomToken: "room",
      });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
    });

    test("join_WhenReturningWaiterUsesDifferentId_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      join(bookingSession, "c");
      join(bookingSession, "d");
      bookingSession.leaveWaitlist({
        actorId: "c",
        participationId: "p-c",
        now: before,
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.join(loadedUser("c"), {
          participationId: "different",
          holdId: "h-c",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenReturningWaiterReusesId_AssignsFreshQueuePosition", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      join(bookingSession, "c");
      join(bookingSession, "d");
      bookingSession.leaveWaitlist({
        actorId: "c",
        participationId: "p-c",
        now: before,
      });

      // Act
      const reentry = join(bookingSession, "c");

      // Assert
      expect(reentry.kind).toBe("WAITLISTED");
      expect(bookingSession.nextWaitlistedUserId).toBe("d");
      expect(
        bookingSession.participations.filter(
          (participation) => participation.userId === "c",
        ),
      ).toHaveLength(1);
    });

    test("join_WhenUserIsAlreadyCommitted_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => join(bookingSession, "a")).toThrow(
        expect.objectContaining({ code: "ALREADY_PARTICIPATING" }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenUserPreviouslyWithdrew_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      bookingSession.withdrawParticipant({
        actorId: "a",
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

    test("join_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();

      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => join(bookingSession, "b", start)).toThrow(
        expect.objectContaining({ code: "SESSION_STARTED" }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });

  describe("Queue promotion", () => {
    test("promoteNext_WhenQueueIsEmpty_ReturnsNoneBeforeValidatingHoldId", () => {
      // Arrange
      const bookingSession = session();
      const previousState = sessionState(bookingSession);

      // Act
      const result = bookingSession.promoteNext(loadedUser("a"), {
        holdId: "",
        now: before,
      });

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
        bookingSession.promoteNext(loadedUser("a"), { holdId: "", now: start }),
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
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: at(2),
      });
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
          bookingSession.promoteNext(loadedUser("first-waiter"), {
            holdId: "h-promoted",
            now: at(1),
          }),
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
      bookingSession.join(unfundedUser, {
        participationId: "p-c",
        now: before,
      });
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: before,
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        bookingSession.promoteNext(loadedUser("other"), {
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
      const waitlistAdmission = bookingSession.join(unfundedUser, {
        participationId: "p-c",
        now: before,
      });
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: before,
      });
      const reloadedUser = loadedUser("c", { wallet: fundedWallet("c", 500) });

      // Act
      const promotion = bookingSession.promoteNext(reloadedUser, {
        holdId: "h-c",
        now: before,
      });

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
      const waitlistAdmission = bookingSession.join(
        loadedUser("c", {
          wallet: fundedWallet("c", 0),
        }),
        {
          participationId: "p-c",
          holdId: "h-c",
          now: before,
        },
      );
      join(bookingSession, "d");
      bookingSession.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: before,
      });
      const freshAdmission = join(bookingSession, "fresh");
      const firstPromotion = bookingSession.promoteNext(
        loadedUser("c", {
          wallet: fundedWallet("c", 0),
        }),
        {
          holdId: "h-c",
          now: before,
        },
      );
      const nextWaiterAfterSkip = bookingSession.nextWaitlistedUserId;
      const secondPromotion = bookingSession.promoteNext(loadedUser("d"), {
        holdId: "h-d",
        now: before,
      });

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
