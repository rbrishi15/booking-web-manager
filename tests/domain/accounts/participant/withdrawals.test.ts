import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  withdrawnParticipation,
  createTestUser,
  createTestSession,
  sessionState,
  sessionStartsAt,
} from "../../sessions/session/session-fixtures";

describe("Participant withdrawal and refund choices", () => {
  describe("Refund cutoff", () => {
    test.each(["OPEN_SLOT", undefined] as const)("rejects late waitlist withdrawal (%s) without changing the place or hold", (replacementMode) => {
      const session = createTestSession({ committedUserIds: ["alice"] });
      const before = session.participantList.requireParticipation("p-alice");

      expect(() => createTestUser({ userId: "alice" }).asParticipant().withdraw(session, {
        participationId: "p-alice",
        now: new Date(hoursBeforeSessionStart(30).getTime() + 1),
        replacementMode,
      })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

      expect(session.participantList.requireParticipation("p-alice")).toBe(before);
      expect(before.hold?.state).toBe("HELD");
    });

    test("withdraw_WhenCommittedBeforeRefundCutoff_RefundsParticipant", () => {
      const participant = createTestUser({
        userId: "participant",
      }).asParticipant();
      const session = createTestSession({ committedUserIds: ["participant"] });

      const withdrawal = participant.withdraw(session, {
        participationId: "p-participant",
        now: hoursBeforeSessionStart(31),
      });

      const withdrawn =
        session.participantList.requireParticipation("p-participant");

      expect(withdrawal.kind).toBe("REFUNDED");
      expect(withdrawn.userId).toBe(participant.userId);
      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(withdrawn.hold?.state).toBe("REFUNDED");
      expect(withdrawal.instructions).toEqual([
        expect.objectContaining({
          kind: "REFUND",
          participationId: "p-participant",
          holdId: "h-participant",
          walletId: "w-participant",
        }),
      ]);
      expect(withdrawal.instructions[0]?.amount.toCents()).toBe(500);
    });

    test("withdraw_WhenParticipantIsUnverified_StillRefundsAnExistingEarlyCommitment", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const alice = createTestUser({
        userId: "alice",
        emailVerified: false,
      }).asParticipant();

      const withdrawal = alice.withdraw(bookingSession, {
        participationId: "p-alice",
        now: hoursBeforeSessionStart(48),
      });

      expect(withdrawal.kind).toBe("REFUNDED");
      expect(withdrawal.instructions[0]?.kind).toBe("REFUND");
      expect(withdrawal.instructions[0]?.amount.toCents()).toBe(500);
      expect(
        bookingSession.participantList.requireParticipation("p-alice").status,
      ).toBe("WITHDRAWN");
    });

    test("withdraw_WhenOneMillisecondBeforeRefundCutoff_RefundsHold", () => {
      const refundCutoff = hoursBeforeSessionStart(30);
      const oneMillisecondBeforeRefundCutoff = new Date(
        refundCutoff.getTime() - 1,
      );
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const withdrawal = createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: oneMillisecondBeforeRefundCutoff,
        });

      expect(withdrawal.kind).toBe("REFUNDED");
      expect(
        bookingSession.participantList.requireParticipation("p-alice").hold
          ?.state,
      ).toBe("REFUNDED");
    });

    test("withdraw_WhenExactlyAtRefundCutoff_RefundsHold", () => {
      const refundCutoff = hoursBeforeSessionStart(30);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const withdrawal = createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: refundCutoff,
        });

      expect(withdrawal.kind).toBe("REFUNDED");
      expect(
        bookingSession.participantList.requireParticipation("p-alice").hold
          ?.state,
      ).toBe("REFUNDED");
    });

    test("withdraw_WhenOneSecondInsideRefundCutoff_AwaitsReplacement", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const withdrawal = createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "bob",
          now: new Date(hoursBeforeSessionStart(30).getTime() + 1_000),
        });

      expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
      expect(
        bookingSession.participantList.requireParticipation("p-alice").hold
          ?.state,
      ).toBe("AWAITING_REPLACEMENT");
    });
  });

  describe("Replacement invitations", () => {
    test("withdraw_WhenParticipantDirectlyInvitesSomeone_ReservesSeatWithoutCommittingInviteeOrRefunding", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const bookingSession = createTestSession({
        committedUserIds: ["ben", "alex"],
      });

      const withdrawal = createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
          now: withdrawalTime,
        });

      expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
      expect(withdrawal.instructions).toEqual([]);
      expect(
        bookingSession.participantList.findByUserId("cara"),
      ).toBeUndefined();
      expect(
        bookingSession.participantList.requireParticipation("p-ben").hold
          ?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(
        bookingSession.participantList.personalReplacementForInvitee("cara")
          ?.participationId,
      ).toBe("p-ben");
      expect(bookingSession.participantList.committedCount).toBe(1);
      expect(bookingSession.participantList.reservedCount).toBe(1);
      expect(bookingSession.getAvailableSlots(withdrawalTime)).toBe(0);
    });

    test("withdraw_WhenInviteeAlreadyWaits_KeepsTheirQueueEntryUntilTheyAccept", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana", "cara"],
      });
      const waiting =
        bookingSession.participantList.requireParticipation("p-cara");
      const queueSequence = bookingSession.participantList.nextQueueSequence;

      const withdrawal = createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
          now: hoursBeforeSessionStart(10),
        });

      expect(withdrawal.instructions).toEqual([]);
      expect(
        bookingSession.participantList.requireParticipation("p-cara"),
      ).toBe(waiting);
      expect(waiting.status).toBe("WAITLISTED");
      expect(waiting.hold).toBeUndefined();
      expect(waiting.queueSequence).toBe(2);
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "dana",
      );
      expect(bookingSession.participantList.nextQueueSequence).toBe(
        queueSequence,
      );
      expect(bookingSession.participantList.reservedCount).toBe(1);
    });

    test("withdraw_WhenEarlyParticipantInvitesOnePerson_RefundsAndReservesTheirSeat", () => {
      const withdrawalTime = hoursBeforeSessionStart(40);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });

      const withdrawal = createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: withdrawalTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        });
      const withdrawn =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(withdrawal.kind).toBe("REFUNDED");
      expect(
        withdrawal.instructions.map((instruction) => instruction.kind),
      ).toEqual(["REFUND"]);
      expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
      expect(withdrawn.replacementInviteeId).toBe("cara");
      expect(withdrawn.hold?.state).toBe("REFUNDED");
      expect(bookingSession.getAvailableSlots(withdrawalTime)).toBe(0);
    });

    test("withdraw_WhenNamedRecipientIsMissing_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-alice",
            now: hoursBeforeSessionStart(40),
            replacementMode: "DIRECT_INVITE",
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("withdraw_WhenParticipantInvitesThemself_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-alice",
            now: hoursBeforeSessionStart(10),
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "alice",
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("withdraw_WhenInviteeAlreadyHasACommittedSeat_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-alice",
            now: hoursBeforeSessionStart(10),
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "ben",
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("withdraw_WhenInviteeAlreadyHasAnotherReservation_RejectsWithoutChangingState", () => {
      const firstWithdrawalTime = hoursBeforeSessionStart(10);
      const secondWithdrawalTime = hoursBeforeSessionStart(9);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: firstWithdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "ben" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-ben",
            now: secondWithdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
          }),
      ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });

  describe("Replacement choice cannot be changed", () => {
    test("withdraw_WhenParticipantChoseInvitation_RejectsSwitchToWaitlistAndKeepsReservedSeat", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const choiceChangeTime = hoursBeforeSessionStart(9);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["dana"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: withdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });
      const alice = createTestUser({ userId: "alice" }).asParticipant();
      const previousState = sessionState(bookingSession);

      expect(() =>
        alice.withdraw(bookingSession, {
          participationId: "p-alice",
          now: choiceChangeTime,
          replacementMode: "OPEN_SLOT",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

      const withdrawn =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(sessionState(bookingSession)).toEqual(previousState);
      expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
      expect(withdrawn.replacementInviteeId).toBe("cara");
      expect(bookingSession.getAvailableSlots(choiceChangeTime)).toBe(0);
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "dana",
      );
    });

    test("withdraw_WhenParticipantChoseWaitlist_RejectsSwitchToInvitationAndKeepsOpenSeat", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const choiceChangeTime = hoursBeforeSessionStart(9);
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        waitlistedUserIds: ["dana"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: withdrawalTime,
            replacementMode: "OPEN_SLOT",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });
      const alice = createTestUser({ userId: "alice" }).asParticipant();
      const previousState = sessionState(bookingSession);

      expect(() =>
        alice.withdraw(bookingSession, {
          participationId: "p-alice",
          now: choiceChangeTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

      const withdrawn =
        bookingSession.participantList.requireParticipation("p-alice");

      expect(sessionState(bookingSession)).toEqual(previousState);
      expect(withdrawn.replacementMode).toBe("OPEN_SLOT");
      expect(withdrawn.replacementInviteeId).toBeUndefined();
      expect(bookingSession.getAvailableSlots(choiceChangeTime)).toBe(1);
      expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
        "dana",
      );
    });

    test("withdraw_WhenParticipantAlreadyInvitedSomeone_RejectsSecondInvitation", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const secondInvitationTime = hoursBeforeSessionStart(9);
      const bookingSession = createTestSession({
        committedUserIds: ["ben", "alex"],
        participationOverrides: {
          ben: withdrawnParticipation("ben", {
            withdrawnAt: withdrawalTime,
            replacementMode: "DIRECT_INVITE",
            replacementInviteeId: "cara",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });
      const ben = createTestUser({ userId: "ben" }).asParticipant();
      const previousState = sessionState(bookingSession);

      expect(() =>
        ben.withdraw(bookingSession, {
          participationId: "p-ben",
          now: secondInvitationTime,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "dana",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
      expect(
        bookingSession.participantList.personalReplacementForInvitee("cara")
          ?.replacementInviteeId,
      ).toBe("cara");
      expect(
        bookingSession.participantList.personalReplacementForInvitee("dana"),
      ).toBeUndefined();
      expect(bookingSession.participantList.reservedCount).toBe(1);
      expect(bookingSession.getAvailableSlots(secondInvitationTime)).toBe(0);
    });
  });

  describe("Withdrawal eligibility", () => {
    test("withdraw_WhenActorDoesNotOwnParticipation_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "other" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-alice",
            now: hoursBeforeSessionStart(48),
          }),
      ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("withdraw_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .withdraw(bookingSession, {
            participationId: "p-alice",
            now: sessionStartsAt,
          }),
      ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));

      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });

  describe("Withdrawal preview", () => {
    test("previewWithdrawal_WhenMoreThan30HoursBeforeStart_ShowsFullRefundWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      const preview = createTestUser({ userId: "alice" })
        .asParticipant()
        .previewWithdrawal(bookingSession, hoursBeforeSessionStart(31));

      expect(preview.kind).toBe("REFUNDED");
      expect(preview.participationId).toBe("p-alice");
      expect(preview.refundAmount.toCents()).toBe(500);
      expect(preview.heldAmount.toCents()).toBe(500);
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("previewWithdrawal_WhenExactlyAtRefundCutoff_ShowsFullRefund", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      const preview = createTestUser({ userId: "alice" })
        .asParticipant()
        .previewWithdrawal(bookingSession, hoursBeforeSessionStart(30));

      expect(preview.kind).toBe("REFUNDED");
      expect(preview.refundAmount.toCents()).toBe(500);
      expect(preview.heldAmount.toCents()).toBe(500);
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("previewWithdrawal_WhenFollowedByWithdrawalAtSameTime_MatchesItsOutcome", () => {
      const now = hoursBeforeSessionStart(30);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const alice = createTestUser({ userId: "alice" }).asParticipant();

      const preview = alice.previewWithdrawal(bookingSession, now);
      const withdrawal = alice.withdraw(bookingSession, {
        participationId: "p-alice",
        now,
      });

      expect(withdrawal.kind).toBe(preview.kind);
      expect(
        withdrawal.instructions.map((instruction) =>
          instruction.amount.toCents(),
        ),
      ).toEqual([preview.refundAmount.toCents()]);
    });

    test("previewWithdrawal_WhenUserIsNotParticipating_RejectsWithNotFound", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      expect(() =>
        createTestUser({ userId: "other" })
          .asParticipant()
          .previewWithdrawal(bookingSession, hoursBeforeSessionStart(40)),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    });

    test("previewWithdrawal_WhenAlreadyWithdrawn_RejectsWithInvalidState", () => {
      const bookingSession = createTestSession({
        committedUserIds: ["alice", "ben"],
        participationOverrides: {
          alice: withdrawnParticipation("alice", {
            withdrawnAt: hoursBeforeSessionStart(10),
            replacementMode: "OPEN_SLOT",
            holdState: "AWAITING_REPLACEMENT",
          }),
        },
      });
      const alice = createTestUser({ userId: "alice" }).asParticipant();

      expect(() =>
        alice.previewWithdrawal(bookingSession, hoursBeforeSessionStart(9)),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    });

    test("previewWithdrawal_WhenSessionStartsNow_RejectsWithSessionStarted", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      expect(() =>
        createTestUser({ userId: "alice" })
          .asParticipant()
          .previewWithdrawal(bookingSession, sessionStartsAt),
      ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    });
  });

  describe("Forfeit", () => {
    test("withdraw_WhenLateParticipantForfeits_MakesShareDueToBookerWithoutRefund", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });

      const withdrawal = createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          replacementMode: "FORFEIT",
          now: withdrawalTime,
        });

      const alice = bookingSession.participantList.requireParticipation("p-alice");
      expect(withdrawal.kind).toBe("FORFEITURE_DUE");
      expect(withdrawal.instructions).toEqual([]);
      expect(alice.status).toBe("WITHDRAWN");
      expect(alice.replacementMode).toBe("FORFEIT");
      expect(alice.hold?.state).toBe("FORFEITURE_DUE");
      expect(alice.hold?.amount.toCents()).toBe(500);
    });

    test("withdraw_WhenLateParticipantForfeits_ClosesTheirPlace", () => {
      const withdrawalTime = hoursBeforeSessionStart(10);
      // Three places: the booker's own, alice's and ben's.
      const bookingSession = createTestSession({
        totalSlots: 3,
        committedUserIds: ["alice", "ben"],
      });

      createTestUser({ userId: "alice" }).asParticipant().withdraw(bookingSession, {
        participationId: "p-alice",
        replacementMode: "FORFEIT",
        now: withdrawalTime,
      });

      expect(bookingSession.getAvailableSlots(withdrawalTime)).toBe(0);
      expect(bookingSession.participantList.oldestAwaitingReplacement()).toBeUndefined();
    });

    test("withdraw_WhenForfeitingExactlyAtRefundCutoff_RejectsWithoutChangingState", () => {
      const refundCutoff = hoursBeforeSessionStart(30);
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" }).asParticipant().withdraw(bookingSession, {
          participationId: "p-alice",
          replacementMode: "FORFEIT",
          now: refundCutoff,
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("withdraw_WhenForfeitNamesAnInvitee_RejectsWithoutChangingState", () => {
      const bookingSession = createTestSession({ committedUserIds: ["alice"] });
      const previousState = sessionState(bookingSession);

      expect(() =>
        createTestUser({ userId: "alice" }).asParticipant().withdraw(bookingSession, {
          participationId: "p-alice",
          replacementMode: "FORFEIT",
          replacementInviteeId: "cara",
          now: hoursBeforeSessionStart(10),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(sessionState(bookingSession)).toEqual(previousState);
    });
  });
});
