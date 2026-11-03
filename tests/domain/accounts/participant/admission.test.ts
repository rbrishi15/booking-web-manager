import {
  DomainError,
  LedgerTransaction,
  Money,
  ReliabilityScore,
  Session,
  Wallet,
} from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  hoursBeforeSessionStart,
  leftWaitlistedParticipation,
  removedParticipation,
  withdrawnParticipation,
  sessionDetails,
  createTestUser,
  createTestSession,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Participant session admission", () => {
  describe("Account and session eligibility", () => {
    test("join_WhenRoleWasCreatedBeforeDeactivation_ThrowsInactiveAccount", () => {
      const participantUser = createTestUser({
        userId: "participant",
        availableFundsCents: 0,
      });
      const session = createTestSession();
      const participant = participantUser.asParticipant();
      participantUser.deactivate({
        availableBalance: Money.fromCents(0),
        heldBalance: Money.fromCents(0),
        activeCommitments: 0,
        unsettledOwnedSessions: 0,
        pendingPayouts: 0,
        activeOwnedGroups: 0,
      });

      expect(() =>
        participant.join(session, {
          participationId: "participation",
          holdId: "hold",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));

      expect(session.participantList.participations).toEqual([]);
    });

    test("join_WhenRoleWasCreatedAfterDeactivation_ThrowsInactiveAccount", () => {
      const participantUser = createTestUser({
        userId: "participant",
        availableFundsCents: 0,
        accountStatus: "INACTIVE",
      });
      const session = createTestSession();
      const participant = participantUser.asParticipant();

      expect(() =>
        participant.join(session, {
          participationId: "participation",
          holdId: "hold",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));

      expect(session.participantList.participations).toEqual([]);
    });

    test("join_WhenEmailIsMissingAndSessionIsFull_RejectsWithoutChangingWaitlist", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const cara = createTestUser({
        userId: "cara",
        email: null,
        emailVerified: false,
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        cara.asParticipant().join(bookingSession, {
          participationId: "p-cara",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "EMAIL_REQUIRED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenEmailIsUnverified_AllowsAdmission", () => {
      const bookingSession = createTestSession();
      const alice = createTestUser({ userId: "alice", emailVerified: false });

      const admission = alice.asParticipant().join(bookingSession, {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      });
      const aliceParticipation =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(admission.kind).toBe("COMMITTED");
      expect(aliceParticipation.status).toBe("COMMITTED");
      expect(aliceParticipation.hold?.state).toBe("HELD");
      expect(aliceParticipation.hold?.amount.toCents()).toBe(500);
      expect(alice.wallet.getAvailableBalance().toCents()).toBe(10_000);
    });

    test("join_WhenUserIsInactive_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession();
      const alice = createTestUser({
        userId: "alice",
        accountStatus: "INACTIVE",
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        alice.asParticipant().join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession();

      const previousState = sessionState(bookingSession);

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

  describe("Private sessions and group restrictions", () => {
    test("join_WhenUserIsNotInInvitedGroup_RejectsWithoutChangingState", () => {
      const privateSession = new Session(
        sessionDetails({
          visibility: "PRIVATE",
          invitedGroupId: "group",
          minimumReliability: ReliabilityScore.from(80),
        }),
      );
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      };
      const alice = createTestUser({ userId: "alice" });
      const previousState = sessionState(privateSession);

      expect(() => alice.asParticipant().join(privateSession, command)).toThrow(
        expect.objectContaining({ code: "INVALID_ACCESS" }),
      );

      expect(sessionState(privateSession)).toEqual(previousState);
    });

    test("join_WhenMemberIsBelowReliabilityThreshold_RejectsWithoutChangingState", () => {
      const privateSession = new Session(
        sessionDetails({
          visibility: "PRIVATE",
          invitedGroupId: "group",
          minimumReliability: ReliabilityScore.from(80),
        }),
      );
      const command = {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      };
      const alice = createTestUser({
        userId: "alice",
        memberGroupIds: ["group"],
        reliabilityScore: ReliabilityScore.from(79),
      });
      const previousState = sessionState(privateSession);

      expect(() => alice.asParticipant().join(privateSession, command)).toThrow(
        expect.objectContaining({ code: "LOW_RELIABILITY" }),
      );

      expect(sessionState(privateSession)).toEqual(previousState);
    });

    test("join_WhenInvitedMemberMeetsReliabilityThreshold_CommitsFromLoadedWallet", () => {
      const privateSession = new Session(
        sessionDetails({
          visibility: "PRIVATE",
          invitedGroupId: "group",
          minimumReliability: ReliabilityScore.from(80),
        }),
      );
      const eligibleUser = createTestUser({
        userId: "alice",
        memberGroupIds: ["group"],
        reliabilityScore: ReliabilityScore.from(80),
      });

      const admission = eligibleUser.asParticipant().join(privateSession, {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      });

      expect(admission.kind).toBe("COMMITTED");
      expect(admission.instructions[0]?.walletId).toBe(
        eligibleUser.wallet.walletId,
      );
    });

    test("join_WhenPrivateRoomTokenIsMissing_RejectsWithoutChangingState", () => {
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = new Session(
        sessionDetails({ visibility: "PRIVATE" }),
      );
      const previousState = sessionState(bookingSession);

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
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = new Session(
        sessionDetails({ visibility: "PRIVATE" }),
      );

      const admission = createTestUser({ userId: "alice" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: joinTime,
          roomToken: "room",
        });

      expect(admission.kind).toBe("COMMITTED");
    });
  });

  describe("Funds and queue admission", () => {
    test("join_WhenUserHasFunds_LocksShareFromLoadedWallet", () => {
      const participantUser = createTestUser({ userId: "participant" });
      const session = createTestSession();

      const admission = participantUser.asParticipant().join(session, {
        participationId: "participation",
        holdId: "hold",
        now: hoursBeforeSessionStart(48),
      });

      expect(admission.kind).toBe("COMMITTED");
      expect(
        session.participantList.requireParticipation("participation").userId,
      ).toBe(participantUser.userId);
      expect(admission.instructions).toEqual([
        expect.objectContaining({
          kind: "LOCK",
          walletId: "w-participant",
          participationId: "participation",
          holdId: "hold",
        }),
      ]);
      expect(admission.instructions[0]?.amount.toCents()).toBe(500);
    });

    test("join_WhenFundsExactlyCoverShare_CommitsAndEmitsLock", () => {
      const bookingSession = createTestSession();
      const fundedUser = createTestUser({
        userId: "alice",
        availableFundsCents: 500,
      });

      const admission = fundedUser.asParticipant().join(bookingSession, {
        participationId: "p-alice",
        holdId: "h-alice",
        now: hoursBeforeSessionStart(48),
      });

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

    test("join_WhenFundsAreOneCentBelowShare_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession();
      const alice = createTestUser({
        userId: "alice",
        availableFundsCents: 499,
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        alice.asParticipant().join(bookingSession, {
          participationId: "p-alice",
          holdId: "h-alice",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenReloadedWalletIncludesPriorLock_RejectsWithoutChangingState", () => {
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

      expect(() =>
        reloadedUser.asParticipant().join(nextSession, command),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));

      expect(sessionState(nextSession)).toEqual(previousState);
      expect(fundedUser.wallet.getAvailableBalance().toCents()).toBe(500);
      expect(reloadedUser.wallet.getAvailableBalance().toCents()).toBe(0);
    });

    test("join_WhenSessionIsFullAndUserCannotFundShare_RejectsWithoutQueueing", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const cara = createTestUser({
        userId: "cara",
        availableFundsCents: 499,
      }).asParticipant();
      const previousState = sessionState(bookingSession);

      expect(() =>
        cara.join(bookingSession, {
          participationId: "p-cara",
          now: hoursBeforeSessionStart(48),
        }),
      ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("join_WhenSessionIsFullAndUserCanFundShare_JoinsWaitlistWithoutLockingFunds", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const cara = createTestUser({
        userId: "cara",
        availableFundsCents: 500,
      }).asParticipant();

      const admission = cara.join(bookingSession, {
        participationId: "p-cara",
        now: hoursBeforeSessionStart(48),
      });
      const waiting =
        bookingSession.participantList.requireParticipation("p-cara");

      expect(admission).toEqual({
        kind: "WAITLISTED",
        participationId: "p-cara",
        instructions: [],
      });
      expect(waiting.status).toBe("WAITLISTED");
      expect(waiting.hold).toBeUndefined();
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "cara",
      );
    });

    test("join_WhenWaitersExistAndSlotIsAvailable_QueuesBehindExistingWaiters", () => {
      const joinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["ben"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const evan = createTestUser({ userId: "evan" }).asParticipant();

      const admission = evan.join(bookingSession, {
        participationId: "p-evan",
        holdId: "h-evan",
        now: joinTime,
      });

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
  });

  describe("Participation history and reentry", () => {
    test("join_WhenReturningWaiterUsesDifferentId_RejectsWithoutChangingState", () => {
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
        participationOverrides: {
          cara: leftWaitlistedParticipation("cara", 1),
        },
      });
      const previousState = sessionState(bookingSession);

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
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["cara", "dana"],
        participationOverrides: {
          cara: leftWaitlistedParticipation("cara", 1),
        },
      });
      const previousList = bookingSession.participantList;
      const departedCara = previousList.requireParticipation("p-cara");

      const reentry = createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: rejoinTime,
        });
      const participations = bookingSession.participantList.participations;

      expect(reentry.kind).toBe("WAITLISTED");
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "dana",
      );
      expect(
        participations.filter(
          (participation) => participation.userId === "cara",
        ),
      ).toHaveLength(1);
      expect(
        participations.map((participation) => participation.userId),
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
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const previousState = sessionState(bookingSession);

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
      const withdrawalTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: withdrawalTime,
            replacementMode: "OPEN_SLOT",
            holdState: "REFUNDED",
            settledAt: withdrawalTime,
          }),
        },
      });
      const previousState = sessionState(bookingSession);

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

    test("join_WhenParticipantWasRemoved_RejectsWithoutChangingState", () => {
      const removalTime = hoursBeforeSessionStart(48);
      const rejoinTime = hoursBeforeSessionStart(48);
      const bookingSession = createTestSession({
        committedUserIds: ["alice"],
        participationOverrides: {
          alice: removedParticipation("alice", { settledAt: removalTime }),
        },
      });
      const previousState = sessionState(bookingSession);

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

  describe("Replacement admission", () => {
    test("acceptReplacement_WhenNamedInviteeAcceptsNewerPrivateInvitation_RefundsOnlyTheirInviter", () => {
      const aliceWithdrawalTime = hoursBeforeSessionStart(20);
      const benWithdrawalTime = hoursBeforeSessionStart(19);
      const acceptanceTime = hoursBeforeSessionStart(18);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        visibility: "PRIVATE",
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: aliceWithdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "donna",
            holdState: "AWAITING_REPLACEMENT",
          }),
          ben: withdrawnParticipation("ben", {
            withdrawnAt: benWithdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });

      const replacement = createTestUser({ userId: "cara" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: acceptanceTime,
        });

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

    test("join_WhenReplacementRefundFails_LeavesRosterQueueAndHoldsUnchanged", () => {
      const withdrawalTime = hoursBeforeSessionStart(2);
      const replacementJoinTime = hoursBeforeSessionStart(1);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["former-waiter"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: withdrawalTime,
            replacementMode: "OPEN_SLOT",
            holdState: "AWAITING_REPLACEMENT",
          }),
          "former-waiter": leftWaitlistedParticipation("former-waiter", 1),
        },
      });
      const previousState = sessionState(bookingSession);
      const awaiting =
        bookingSession.participantList.requireParticipation("p-alice");

      // Simulate the replacement refund failing during admission.
      const refund = vi
        .spyOn(awaiting, "refundReplacement")
        .mockImplementationOnce(() => {
          throw new DomainError("INVALID_STATE", "Replacement refund failed");
        });

      try {
        expect(() =>
          createTestUser({ userId: "replacement" })
            .asParticipant()
            .join(bookingSession, {
              participationId: "p-replacement",
              holdId: "h-replacement",
              now: replacementJoinTime,
            }),
        ).toThrow(
          expect.objectContaining({
            code: "INVALID_STATE",
            message: "Replacement refund failed",
          }),
        );

        expect(sessionState(bookingSession)).toEqual(previousState);
      } finally {
        refund.mockRestore();
      }
    });

    test("acceptReplacement_WhenInvitationWasAcceptedAndOrdinarySlotIsAvailable_RejectsWithoutChangingState", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const repeatAcceptanceTime = hoursBeforeSessionStart(8);
      const bookingSession = createTestSession({
        committedUserIds: ["ben"],
        participationOverrides: {
          ben: withdrawnParticipation("ben", {
            withdrawnAt: withdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
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
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const ordinaryJoinTime = hoursBeforeSessionStart(8);
      const repeatAcceptanceTime = hoursBeforeSessionStart(7);
      const bookingSession = createTestSession({
        committedUserIds: ["ben"],
        participationOverrides: {
          ben: withdrawnParticipation("ben", {
            withdrawnAt: withdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
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
  });

  describe("Forfeited places", () => {
    test("join_WhenTheOnlyGuestPlaceWasForfeited_WaitlistsApplicant", () => {
      // Two places: the booker's own and ben's, which ben forfeited.
      const bookingSession = createTestSession({
        totalSlots: 2,
        committedUserIds: ["ben"],
        participationOverrides: {
          ben: withdrawnParticipation("ben", {
            withdrawnAt: hoursBeforeSessionStart(10),
            replacementMode: "FORFEIT",
            holdState: "FORFEITURE_DUE",
          }),
        },
      });

      const admission = createTestUser({ userId: "cara" }).asParticipant().join(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: hoursBeforeSessionStart(5),
      });

      expect(admission.kind).toBe("WAITLISTED");
      expect(bookingSession.participantList.requireParticipation("p-cara").hold).toBeUndefined();
    });
  });
});
