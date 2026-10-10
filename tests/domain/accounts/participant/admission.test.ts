import {
  DomainError,
  LedgerTransaction,
  Money,
  ReliabilityScore,
  Wallet,
} from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  creationDetails,
  createTestUser,
  readyBooker,
  createTestSession,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  describe("Admission and reentry", () => {
    test("join_WhenEmailIsMissingAndSessionIsFull_RejectsWithoutChangingWaitlist", () => {
      // Arrange
      const bookingSession = createTestSession({ committedUserIds: ["alice", "ben"] });
      const applicant = createTestUser({ userId: "cara", email: null, emailVerified: false });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => applicant.asParticipant().join(bookingSession, {
        participationId: "p-cara",
        now: hoursBeforeSessionStart(48),
      })).toThrow(expect.objectContaining({ code: "EMAIL_REQUIRED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenEmailIsUnverified_AllowsAdmission", () => {
      // Arrange
      const bookingSession = createTestSession();
      const applicant = createTestUser({ userId: "alice", emailVerified: false });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(applicant.asParticipant().join(bookingSession, {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      })).toMatchObject({ kind: "COMMITTED" });
      expect(sessionState(bookingSession)).not.toEqual(previousState);
      expect(applicant.wallet.getAvailableBalance().toCents()).toBe(10_000);
    });

    test("join_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      // Arrange
      const waitlistDepartureTime = hoursBeforeSessionStart(48);
      const withdrawalTime = hoursBeforeSessionStart(2);
      const replacementJoinTime = hoursBeforeSessionStart(1);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["former-waiter"],
      });

      createTestUser({ userId: "former-waiter" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-former-waiter",
          now: waitlistDepartureTime,
        });
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: withdrawalTime,
        });
      const previousState = sessionState(bookingSession);
      const awaiting =
        bookingSession.participantList.requireParticipation("p-alice");
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
              now: replacementJoinTime,
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
        now: hoursBeforeSessionStart(48),
      });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
      expect(admission.instructions).toEqual([
        expect.objectContaining({
          kind: "LOCK",
          participationId: "p-alice",
          holdId: "h-alice",
          walletId: "w-alice",
        }),
      ]);
      expect(admission.instructions[0]?.amount.toCents()).toBe(500);
    });

    test("join_WhenSessionIsFullAndUserHasNoFunds_JoinsWaitlistWithoutLockingFunds", () => {
      // Arrange
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const participant = createTestUser({
        userId: "cara",
        availableFundsCents: 0,
      }).asParticipant();

      // Act
      const admission = participant.join(bookingSession, {
        participationId: "p-cara",
        now: hoursBeforeSessionStart(48),
      });

      // Assert
      expect(admission).toEqual({
        kind: "WAITLISTED",
        participationId: "p-cara",
        instructions: [],
      });
      const waiting =
        bookingSession.participantList.requireParticipation("p-cara");
      expect(waiting.status).toBe("WAITLISTED");
      expect(waiting.hold).toBeUndefined();
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "cara",
      );
    });

    test("join_WhenWaitersExistAndSlotIsAvailable_QueuesBehindExistingWaiters", () => {
      // Arrange
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["ben"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const participant = createTestUser({ userId: "evan" }).asParticipant();

      // Act
      const admission = participant.join(bookingSession, {
        participationId: "p-evan",
        holdId: "h-evan",
        now: joinTime,
      });

      // Assert
      expect(admission.kind).toBe("WAITLISTED");
      expect(admission.instructions).toEqual([]);
      expect(
        bookingSession.participantList.requireParticipation("p-evan")
          .queueSequence,
      ).toBe(3);
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "cara",
      );
      expect(bookingSession.participantList.nextQueueSequence).toBe(4);
      expect(bookingSession.getAvailableSlots(joinTime)).toBe(1);
    });

    test("join_WhenReloadedWalletIncludesPriorLock_RejectsWithoutChangingState", () => {
      // Arrange
      const commitmentTime = hoursBeforeSessionStart(48);
      const fundedUser = createTestUser({
        userId: "alice",
        availableFundsCents: 500,
      });
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: commitmentTime,
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
              occurredAt: commitmentTime,
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
      expect(fundedUser.wallet.getAvailableBalance().toCents()).toBe(500);
      expect(reloadedUser.wallet.getAvailableBalance().toCents()).toBe(0);
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
        now: hoursBeforeSessionStart(48),
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
        now: hoursBeforeSessionStart(48),
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
        now: hoursBeforeSessionStart(48),
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
          now: hoursBeforeSessionStart(48),
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
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenPrivateRoomTokenIsMissing_RejectsWithoutChangingState", () => {
      // Arrange
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession();
      readyBooker().changeVisibility(
        bookingSession,
        "PRIVATE",
        visibilityChangeTime,
      );
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: joinTime,
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
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession();
      readyBooker().changeVisibility(
        bookingSession,
        "PRIVATE",
        visibilityChangeTime,
      );

      // Act
      const admission = createTestUser({ userId: "alice" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: joinTime,
          roomToken: "room",
        });

      // Assert
      expect(admission.kind).toBe("COMMITTED");
    });

    test("join_WhenReturningWaiterUsesDifferentId_RejectsWithoutChangingState", () => {
      // Arrange
      const waitlistDepartureTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
      });

      createTestUser({ userId: "cara" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-cara",
          now: waitlistDepartureTime,
        });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "cara" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "different",
            holdId: "h-cara",
            now: rejoinTime,
          }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenReturningWaiterReusesId_AssignsFreshQueuePosition", () => {
      // Arrange
      const waitlistDepartureTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
      });

      createTestUser({ userId: "cara" })
        .asParticipant()
        .leaveWaitlist(bookingSession, {
          participationId: "p-cara",
          now: waitlistDepartureTime,
        });
      const previousList = bookingSession.participantList;
      const departedCara = previousList.requireParticipation("p-cara");

      // Act
      const reentry = createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: rejoinTime,
        });

      // Assert
      expect(reentry.kind).toBe("WAITLISTED");
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "dana",
      );
      expect(
        bookingSession.participantList.participations.filter(
          (participation) => participation.userId === "cara",
        ),
      ).toHaveLength(1);
      expect(
        bookingSession.participantList.participations.map(
          (participation) => participation.userId,
        ),
      ).toEqual(["alice", "ben", "cara", "dana"]);
      expect(bookingSession.participantList.nextQueueSequence).toBe(4);
      expect(
        bookingSession.participantList.requireParticipation("p-cara")
          .queueSequence,
      ).toBe(3);
      expect(bookingSession.participantList).not.toBe(previousList);
      expect(previousList.findByUserId("cara")).toBe(departedCara);
      expect(departedCara.status).toBe("LEFT_WAITLIST");
      expect(departedCara.queueSequence).toBe(1);
      expect(previousList.nextQueueSequence).toBe(3);
      expect(previousList.committedCount).toBe(2);
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
            now: hoursBeforeSessionStart(48),
          }),
      ).toThrow(expect.objectContaining({ code: "ALREADY_PARTICIPATING" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenUserPreviouslyWithdrew_RejectsWithoutChangingState", () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: withdrawalTime,
        });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: rejoinTime,
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
          now: sessionStartsAt,
        }),
      ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
  describe("Replacement admission", () => {
    test("acceptReplacement_WhenNamedInviteeAcceptsNewerPrivateInvitation_RefundsOnlyTheirInviter", () => {
      // Arrange
      const visibilityChangeTime = hoursBeforeSessionStart(48);
      const benJoinTime = hoursBeforeSessionStart(48);
      const aliceWithdrawalTime = hoursBeforeSessionStart(20);
      const benWithdrawalTime = hoursBeforeSessionStart(19);
      const acceptanceTime = hoursBeforeSessionStart(18);
      const bookingSession = createTestSession({
        committedUserIds: ["alice"],
      });
      readyBooker().changeVisibility(
        bookingSession,
        "PRIVATE",
        visibilityChangeTime,
      );
      createTestUser({ userId: "ben" }).asParticipant().join(bookingSession, {
        participationId: "p-ben",
        holdId: "h-ben",
        roomToken: "room",
        now: benJoinTime,
      });

      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: aliceWithdrawalTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "donna",
        });
      createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: benWithdrawalTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        });
      // Act
      const replacement = createTestUser({ userId: "cara" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: acceptanceTime,
        });

      // Assert
      expect(replacement.refundedParticipationId).toBe("p-ben");
      expect(replacement.instructions.map((i) => i.kind)).toEqual([
        "LOCK",
        "REFUND",
      ]);
      expect(
        bookingSession.participantList.findByUserId("alice")?.hold?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(
        bookingSession.participantList.findByUserId("cara")
          ?.replacesParticipationId,
      ).toBe("p-ben");
      expect(bookingSession.getAvailableSlots(acceptanceTime)).toBe(0);
    });

    test("acceptReplacement_WhenInvitationWasAcceptedAndOrdinarySlotIsAvailable_RejectsWithoutChangingState", () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const repeatAcceptanceTime = hoursBeforeSessionStart(8);
      const bookingSession = createTestSession({ committedUserIds: ["ben"] });

      createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: withdrawalTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        });
      const replacement = createTestUser({ userId: "cara" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: acceptanceTime,
        });
      expect(replacement.kind).toBe("COMMITTED");
      expect(replacement.refundedParticipationId).toBe("p-ben");
      expect(bookingSession.getAvailableSlots(repeatAcceptanceTime)).toBe(1);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "cara" })
          .asParticipant()
          .acceptReplacement(bookingSession, {
            participationId: "p-cara",
            holdId: "h-another",
            now: repeatAcceptanceTime,
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("acceptReplacement_WhenInvitationWasAcceptedAndSessionIsFull_RejectsWithoutWaitlisting", () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const ordinaryJoinTime = hoursBeforeSessionStart(8);
      const repeatAcceptanceTime = hoursBeforeSessionStart(7);
      const bookingSession = createTestSession({ committedUserIds: ["ben"] });

      createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: withdrawalTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        });
      createTestUser({ userId: "cara" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: acceptanceTime,
        });
      createTestUser({ userId: "dana" }).asParticipant().join(bookingSession, {
        participationId: "p-dana",
        holdId: "h-dana",
        now: ordinaryJoinTime,
      });
      expect(bookingSession.getAvailableSlots(repeatAcceptanceTime)).toBe(0);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "cara" })
          .asParticipant()
          .acceptReplacement(bookingSession, {
            participationId: "p-cara",
            holdId: "h-another",
            now: repeatAcceptanceTime,
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenParticipantWasRemoved_RejectsWithoutChangingState", () => {
      // Arrange
      const removalTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      readyBooker().removeParticipant(bookingSession, "p-alice", removalTime);
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .join(bookingSession, {
            participationId: "p-alice",
            holdId: "h-alice",
            now: rejoinTime,
          }),
      ).toThrow(expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
});
