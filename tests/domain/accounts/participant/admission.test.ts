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
  createTestUser,
  readyBooker,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  describe("Admission and reentry", () => {
    test("join_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      // Arrange
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["former-waiter"],
      });

      createTestUser({ userId: "former-waiter" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-former-waiter",
          now: before,
        });
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
      const previousState = sessionState(bookingSession);
      const awaiting = bookingSession.participations.find(
        (p) => p.participationId === "p-alice",
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
          createTestUser({ userId: "replacement" })
            .asParticipant()
            .join(bookingSession, {
              participationId: "p-replacement",
              holdId: "h-replacement",
              now: at(1),
            }),
        ).toThrow(failure);
        expect(refund).toHaveBeenCalledOnce();
        expect(sessionState(bookingSession)).toEqual(previousState);
      } finally {
        refund.mockRestore();
      }
    });

    test("join_WhenFundsExactlyCoverShare_CommitsAndEmitsLock", () => {
      // Arrange
      const bookingSession = createTestSession();
      const fundedUser = createTestUser({
        userId: "alice",
        availableFundsCents: 500,
      });

      // Act
      const admission = fundedUser.asParticipant().join(bookingSession, {
        participationId: "p-alice",
        holdId: "h-alice",
        now: before,
      });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
      expect(admission.instructions[0]?.amount.toCents()).toBe(500);
    });

    test("join_WhenReloadedWalletIncludesPriorLock_RejectsWithoutChangingState", () => {
      // Arrange
      const fundedUser = createTestUser({
        userId: "alice",
        availableFundsCents: 500,
      });
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: before,
      };
      fundedUser.asParticipant().join(createTestSession(), command);
      const reloadedUser = createTestUser({
        userId: "alice",
        wallet: new Wallet({
          walletId: fundedUser.wallet.walletId,
          userId: fundedUser.userId,
          transactions: [
            ...fundedUser.wallet.transactions,
            new LedgerTransaction({
              transactionId: "lock-alice",
              walletId: fundedUser.wallet.walletId,
              kind: "LOCK",
              amount: Money.fromCents(500),
              occurredAt: before,
              idempotencyKey: "lock-alice",
              holdId: "h-alice",
            }),
          ],
        }),
      });
      const nextSession = createTestSession();
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
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: before,
      };
      const applicant = createTestUser({ userId: "alice" });
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
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: before,
      };
      const applicant = createTestUser({
        userId: "alice",
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
      const eligibleUser = createTestUser({
        userId: "alice",
        memberGroupIds: ["group"],
        reliabilityScore: ReliabilityScore.from(80),
      });

      // Act
      const admission = eligibleUser.asParticipant().join(privateSession, {
        participationId: "p-alice",
        holdId: "h-alice",
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
      const bookingSession = createTestSession();
      const applicant = createTestUser({
        userId: "alice",
        accountStatus: "INACTIVE",
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        applicant.asParticipant().join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenFundsAreOneCentBelowShare_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession();
      const applicant = createTestUser({
        userId: "alice",
        availableFundsCents: 499,
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        applicant.asParticipant().join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: before,
        }),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenPrivateRoomTokenIsMissing_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession();
      readyBooker().changeVisibility(bookingSession, "PRIVATE", before);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: before,
          }),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_ACCESS",
          message: "The user does not have access to this private session",
        }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenPrivateRoomTokenMatches_CommitsApplicant", () => {
      // Arrange
      const bookingSession = createTestSession();
      readyBooker().changeVisibility(bookingSession, "PRIVATE", before);

      // Act
      const admission = createTestUser({ userId: "alice" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: before,
          roomToken: "room",
        });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
    });

    test("join_WhenReturningWaiterUsesDifferentId_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
      });

      createTestUser({ userId: "cara" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-cara",
          now: before,
        });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "cara" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "different",
            holdId: "h-cara",
            now: before,
          }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenReturningWaiterReusesId_AssignsFreshQueuePosition", () => {
      // Arrange
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
      });

      createTestUser({ userId: "cara" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-cara",
          now: before,
        });

      // Act
      const reentry = createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: before,
        });

      // Assert
      expect(reentry.kind).toBe("WAITLISTED");
      expect(bookingSession.nextWaitlistedUserId).toBe("dana");
      expect(
        bookingSession.participations.filter(
          (participation) => participation.userId === "cara",
        ),
      ).toHaveLength(1);
    });

    test("join_WhenUserIsAlreadyCommitted_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: before,
          }),
      ).toThrow(expect.objectContaining({ code: "ALREADY_PARTICIPATING" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenUserPreviouslyWithdrew_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: before });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: before,
          }),
      ).toThrow(expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
      // Arrange
      const bookingSession = createTestSession();

      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "ben" }).asParticipant().join(bookingSession, {
          participationId: "p-ben",
          holdId: "h-ben",
          now: start,
        }),
      ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
  describe("Replacement admission", () => {
    test("join_WhenEntrantUsesNewerReplacementLink_RefundsOldestWithdrawal", () => {
      // Arrange
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });

      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: at(20),
          replacementMode: "INVITE_LINK",
          replacementToken: "old",
        });
      createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: at(20),
          replacementMode: "INVITE_LINK",
          replacementToken: "new",
        });
      readyBooker().changeVisibility(bookingSession, "PRIVATE", at(19));

      // Act
      const replacement = createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          replacementToken: "new",
          now: at(19),
        });

      // Assert
      expect(replacement.refundedParticipationId).toBe("p-alice");
      expect(replacement.instructions.map((i) => i.kind)).toEqual([
        "LOCK",
        "REFUND",
      ]);
      expect(
        bookingSession.participations.find((p) => p.userId === "ben")?.hold
          ?.state,
      ).toBe("AWAITING_REPLACEMENT");
    });

    test("join_WhenPersonalReplacementLinkWasUsedAndOrdinarySlotIsAvailable_RejectsWithoutChangingState", () => {
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
      const replacement = createTestUser({ userId: "cara" })
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
        createTestUser({ userId: "evan" })
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
      createTestUser({ userId: "dana" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-dana",
          holdId: "h-dana",
          now: at(8),
        });
      expect(bookingSession.getAvailableSlots(at(7))).toBe(0);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "evan" })
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
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      readyBooker().removeParticipant(bookingSession, "p-alice", before);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: before,
          }),
      ).toThrow(expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
});
