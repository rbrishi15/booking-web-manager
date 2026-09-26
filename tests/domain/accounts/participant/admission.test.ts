import {
  DomainError,
  LedgerTransaction,
  Money,
  ReliabilityScore,
  Wallet,
} from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  at,
  before,
  creationDetails,
  join,
  loadedUser,
  readyBooker,
  session,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";
import { fundedWallet } from "../user-fixtures";

describe("Participant", () => {
  describe("Admission and reentry", () => {
    test("join_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      join(bookingSession, "former-waiter");
      loadedUser("former-waiter")
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-former-waiter",
          now: before,
        });
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
      const admission = fundedUser.asParticipant().join(bookingSession, {
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
      fundedUser.asParticipant().join(session(), command);
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
      expect(() =>
        reloadedUser.asParticipant().join(nextSession, command),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
      expect(sessionState(nextSession)).toEqual(previousState);
      expect(fundedUser.wallet.getFunds().toCents()).toBe(500);
      expect(reloadedUser.wallet.getFunds().toCents()).toBe(0);
    });

    test("join_WhenUserIsNotInInvitedGroup_RejectsWithoutChangingState", () => {
      // Arrange
      const privateSession = readyBooker().createSession({
        ...creationDetails(),
        visibility: "PRIVATE",
        invitedGroupId: "group",
        minimumReliability: ReliabilityScore.from(80),
      });
      const command = { participationId: "p-u", holdId: "h-u", now: before };
      const applicant = loadedUser("u");
      const previousState = sessionState(privateSession);

      // Act & Assert
      expect(() =>
        applicant.asParticipant().join(privateSession, command),
      ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
      expect(sessionState(privateSession)).toEqual(previousState);
    });

    test("join_WhenMemberIsBelowReliabilityThreshold_RejectsWithoutChangingState", () => {
      // Arrange
      const privateSession = readyBooker().createSession({
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
      const privateSession = readyBooker().createSession({
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

    test("join_WhenUserIsInactive_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      const applicant = loadedUser("u", { accountStatus: "INACTIVE" });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        applicant.asParticipant().join(bookingSession, {
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
        applicant.asParticipant().join(bookingSession, {
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
      readyBooker().changeVisibility(bookingSession, "PRIVATE", before);
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
      readyBooker().changeVisibility(bookingSession, "PRIVATE", before);

      // Act
      const admission = loadedUser("u").asParticipant().join(bookingSession, {
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
      loadedUser("c")
        .asParticipant()
        .leaveWaitlist(bookingSession, { participationId: "p-c", now: before });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        loadedUser("c").asParticipant().join(bookingSession, {
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
      loadedUser("c")
        .asParticipant()
        .leaveWaitlist(bookingSession, { participationId: "p-c", now: before });

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
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-a", now: before });
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
  describe("Replacement admission", () => {
    test("join_WhenEntrantUsesNewerReplacementLink_RefundsOldestWithdrawal", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      loadedUser("a")
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-a",
          now: at(20),
          replacementMode: "INVITE_LINK",
          replacementToken: "old",
        });
      loadedUser("b")
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-b",
          now: at(20),
          replacementMode: "INVITE_LINK",
          replacementToken: "new",
        });
      readyBooker().changeVisibility(bookingSession, "PRIVATE", at(19));

      // Act
      const replacement = loadedUser("c")
        .asParticipant()
        .join(bookingSession, {
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
        bookingSession.participations.find((p) => p.userId === "b")?.hold
          ?.state,
      ).toBe("AWAITING_REPLACEMENT");
    });

    test("join_WhenPersonalReplacementLinkWasUsedAndOrdinarySlotIsAvailable_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "ben");
      loadedUser("ben")
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: at(10),
          replacementMode: "INVITE_LINK",
          replacementToken: "ben-replacement",
        });
      const replacement = loadedUser("cara")
        .asParticipant()
        .join(bookingSession, {
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
        loadedUser("evan")
          .asParticipant()
          .join(bookingSession, {
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
      loadedUser("ben")
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: at(10),
          replacementMode: "INVITE_LINK",
          replacementToken: "ben-replacement",
        });
      loadedUser("cara")
        .asParticipant()
        .join(bookingSession, {
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
        loadedUser("evan")
          .asParticipant()
          .join(bookingSession, {
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
      readyBooker().removeParticipant(bookingSession, "p-a", before);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => join(bookingSession, "a")).toThrow(
        expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
});
