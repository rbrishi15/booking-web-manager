import { FundHold, Money, Participation, Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  committedParticipation,
  sessionEndsAt,
  pendingPayoutDetails,
  createTestSession,
  sessionDetails,
  sessionState,
  sessionStartsAt,
  verifiedParticipation,
} from "./session-fixtures";

describe("Session", () => {
  test("recordAdmission_WhenOnlySeatIsReserved_RejectsOrdinaryAdmissionWithoutChanges", () => {
    // Arrange
    const aliceInvitedAt = hoursBeforeSessionStart(10);
    const danaTriedToJoinAt = hoursBeforeSessionStart(9);
    const source = createTestSession({ committedUserIds: ["alice", "ben"] });
    const alice = source.participantList.requireParticipation("p-alice");
    const reserved = alice.withdraw(
      alice.hold!.awaitReplacement(),
      aliceInvitedAt,
      "DIRECT_INVITE",
      "cara",
    );
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          reserved,
          source.participantList.requireParticipation("p-ben"),
        ],
      }),
    );
    const admission = committedParticipation(
      bookingSession,
      "dana",
      danaTriedToJoinAt,
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, danaTriedToJoinAt),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenPendingInviteeTakesOrdinaryOpenSeat_RejectsWithoutChanges", () => {
    // Arrange
    const aliceInvitedAt = hoursBeforeSessionStart(10);
    const caraTriedToJoinAt = hoursBeforeSessionStart(9);
    const source = createTestSession({ committedUserIds: ["alice"] });
    const alice = source.participantList.requireParticipation("p-alice");
    const reserved = alice.withdraw(
      alice.hold!.awaitReplacement(),
      aliceInvitedAt,
      "DIRECT_INVITE",
      "cara",
    );
    const bookingSession = new Session(
      sessionDetails({ participations: [reserved] }),
    );
    const admission = committedParticipation(
      bookingSession,
      "cara",
      caraTriedToJoinAt,
    );
    const previousList = bookingSession.participantList;
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, caraTriedToJoinAt),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(bookingSession.participantList).toBe(previousList);
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.getAvailableSlots(caraTriedToJoinAt)).toBe(1);
  });

  test("recordAdmission_WhenPreparedReplacementNamesWrongRecipient_RejectsWithoutChanges", () => {
    // Arrange
    const aliceInvitedAt = hoursBeforeSessionStart(10);
    const danaTriedToAcceptAt = hoursBeforeSessionStart(9);
    const source = createTestSession({ committedUserIds: ["alice"] });
    const alice = source.participantList.requireParticipation("p-alice");
    const reserved = alice.withdraw(
      alice.hold!.awaitReplacement(),
      aliceInvitedAt,
      "DIRECT_INVITE",
      "cara",
    );
    const bookingSession = new Session(
      sessionDetails({ participations: [reserved] }),
    );
    const candidate = committedParticipation(
      bookingSession,
      "dana",
      danaTriedToAcceptAt,
    );
    const admission = Participation.createCommitted({
      participationId: candidate.participationId,
      userId: candidate.userId,
      committedAt: danaTriedToAcceptAt,
      hold: candidate.hold!,
      replacesParticipationId: reserved.participationId,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        reserved.refundReplacement(danaTriedToAcceptAt),
        danaTriedToAcceptAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("constructor_WhenReservedSeatsAndCommitmentsExceedCapacity_RejectsState", () => {
    // Arrange
    const aliceInvitedAt = hoursBeforeSessionStart(48);
    const source = createTestSession();
    const alice = committedParticipation(source, "alice");
    const reserved = alice.withdraw(
      alice.hold!.refund(aliceInvitedAt),
      aliceInvitedAt,
      "DIRECT_INVITE",
      "dana",
    );
    const participations = [
      reserved,
      committedParticipation(source, "ben"),
      committedParticipation(source, "cara"),
    ];

    // Act & Assert
    expect(() => new Session(sessionDetails({ participations }))).toThrow(
      expect.objectContaining({ code: "CAPACITY_EXCEEDED" }),
    );
  });

  test("recordAdmission_WhenHoldIdIsDuplicated_PreservesListAndQueries", () => {
    // Arrange
    const benTriedToJoinAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousList = bookingSession.participantList;
    const alice = previousList.requireParticipation("p-alice");
    const previousState = sessionState(bookingSession);
    const invalidAdmission = Participation.createCommitted({
      participationId: "p-ben",
      userId: "ben",
      committedAt: benTriedToJoinAt,
      hold: FundHold.create({
        holdId: "h-alice",
        participationId: "p-ben",
        holdingAccountId: bookingSession.holdingAccountId,
        walletId: "w-ben",
        amount: bookingSession.bookingShare,
        createdAt: benTriedToJoinAt,
      }),
    });

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        invalidAdmission,
        undefined,
        benTriedToJoinAt,
      ),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(bookingSession.participantList).toBe(previousList);
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(previousList.requireParticipation("p-alice")).toBe(alice);
    expect(previousList.findByUserId("alice")).toBe(alice);
    expect(previousList.findByUserId("ben")).toBeUndefined();
    expect(() => previousList.requireParticipation("p-ben")).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(previousList.committedCount).toBe(1);
    expect(previousList.nextQueueSequence).toBe(1);
    expect(previousList.nextWaitlisted()).toBeUndefined();
    expect(previousList.oldestAwaitingReplacement()).toBeUndefined();
  });

  test("recordAdmission_WhenValidAdmissionFollowsRejectedAttempt_PreservesPreviousList", () => {
    // Arrange
    const benJoinedAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousList = bookingSession.participantList;
    const alice = previousList.requireParticipation("p-alice");
    const invalidAdmission = Participation.createCommitted({
      participationId: "p-ben",
      userId: "ben",
      committedAt: benJoinedAt,
      hold: FundHold.create({
        holdId: "h-alice",
        participationId: "p-ben",
        holdingAccountId: bookingSession.holdingAccountId,
        walletId: "w-ben",
        amount: bookingSession.bookingShare,
        createdAt: benJoinedAt,
      }),
    });
    expect(() =>
      bookingSession.recordAdmission(invalidAdmission, undefined, benJoinedAt),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    const validAdmission = committedParticipation(bookingSession, "ben");

    // Act
    bookingSession.recordAdmission(validAdmission, undefined, benJoinedAt);

    // Assert
    expect(bookingSession.participantList).not.toBe(previousList);
    expect(bookingSession.participantList.requireParticipation("p-ben")).toBe(
      validAdmission,
    );
    expect(bookingSession.participantList.findByUserId("ben")).toBe(
      validAdmission,
    );
    expect(bookingSession.participantList.committedCount).toBe(2);
    expect(previousList.participations).toEqual([alice]);
    expect(previousList.requireParticipation("p-alice")).toBe(alice);
    expect(previousList.findByUserId("ben")).toBeUndefined();
    expect(previousList.committedCount).toBe(1);
    expect(previousList.nextQueueSequence).toBe(1);
  });

  test("recordAdmission_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const admissionAttemptedAt = sessionStartsAt;
    const bookingSession = createTestSession();
    const admission = committedParticipation(
      bookingSession,
      "alice",
      admissionAttemptedAt,
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        undefined,
        admissionAttemptedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenCommitmentExceedsCapacity_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const admission = committedParticipation(bookingSession, "cara");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        undefined,
        hoursBeforeSessionStart(48),
      ),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenNewCommitmentBypassesFirstWaiter_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben"],
      waitlistedUserIds: ["waiting"],
    });
    const admission = committedParticipation(bookingSession, "newcomer");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        undefined,
        hoursBeforeSessionStart(48),
      ),
    ).toThrow(expect.objectContaining({ code: "WAITLIST_NOT_HEAD" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "waiting",
    );
  });

  test("recordAdmission_WhenReturningWaiterChangesParticipationId_RejectsWithoutChangingState", () => {
    // Arrange
    const waitlistedAt = hoursBeforeSessionStart(48);
    const source = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const departedWaiter = new Participation({
      participationId: "p-waiting",
      userId: "waiting",
      status: "LEFT_WAITLIST",
      attendance: "UNVERIFIED",
      waitlistedAt,
      queueSequence: 1,
    });
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          ...source.participantList.participations,
          departedWaiter,
        ],
        nextQueueSequence: 2,
      }),
    );
    const admission = Participation.createWaitlisted({
      participationId: "p-new-waiting",
      userId: "waiting",
      waitlistedAt,
      queueSequence: bookingSession.participantList.nextQueueSequence,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, waitlistedAt),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenReplacementRefundIsMissing_LeavesCommitmentAndHeldFundsUnchanged", () => {
    // Arrange
    const aliceWithdrewAt = hoursBeforeSessionStart(10);
    const replacementTriedToJoinAt = hoursBeforeSessionStart(9);
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          awaitingReplacementParticipation("alice", aliceWithdrewAt),
        ],
      }),
    );
    const candidate = committedParticipation(
      bookingSession,
      "replacement",
      replacementTriedToJoinAt,
    );
    const admission = Participation.createCommitted({
      participationId: candidate.participationId,
      userId: candidate.userId,
      committedAt: replacementTriedToJoinAt,
      hold: candidate.hold!,
      replacesParticipationId: "p-alice",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        undefined,
        replacementTriedToJoinAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenRefundTargetsNewerWithdrawal_LeavesEntireRosterUnchanged", () => {
    // Arrange
    const aliceWithdrewAt = hoursBeforeSessionStart(10);
    const benWithdrewAt = hoursBeforeSessionStart(9);
    const replacementTriedToJoinAt = hoursBeforeSessionStart(8);
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          awaitingReplacementParticipation("alice", aliceWithdrewAt),
          awaitingReplacementParticipation("ben", benWithdrewAt),
        ],
      }),
    );
    const newer = bookingSession.participantList.requireParticipation("p-ben");
    const candidate = committedParticipation(
      bookingSession,
      "replacement",
      replacementTriedToJoinAt,
    );
    const admission = Participation.createCommitted({
      participationId: candidate.participationId,
      userId: candidate.userId,
      committedAt: replacementTriedToJoinAt,
      hold: candidate.hold!,
      replacesParticipationId: "p-alice",
    });
    const refund = newer.refundReplacement(replacementTriedToJoinAt);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(
        admission,
        refund,
        replacementTriedToJoinAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenEarlyPersonalChoiceChangesToOpen_RejectsWithoutChanges", () => {
    // Arrange
    const aliceInvitedAt = hoursBeforeSessionStart(40);
    const choiceChangeAttemptedAt = hoursBeforeSessionStart(39);
    const source = createTestSession({ committedUserIds: ["alice"] });
    const committed = source.participantList.requireParticipation("p-alice");
    const withdrawn = committed.withdraw(
      committed.hold!.refund(aliceInvitedAt),
      aliceInvitedAt,
      "DIRECT_INVITE",
      "ben",
    );
    const bookingSession = new Session(
      sessionDetails({ participations: [withdrawn] }),
    );
    const changedChoice = new Participation({
      participationId: withdrawn.participationId,
      userId: withdrawn.userId,
      status: "WITHDRAWN",
      attendance: withdrawn.attendance,
      committedAt: withdrawn.committedAt,
      withdrawnAt: withdrawn.withdrawnAt,
      replacementMode: "OPEN_SLOT",
      hold: withdrawn.hold,
    });
    const previousList = bookingSession.participantList;
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(
        withdrawn,
        changedChoice,
        choiceChangeAttemptedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(bookingSession.participantList).toBe(previousList);
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenLateOpenChoiceChangesToPersonal_RejectsWithoutChanges", () => {
    // Arrange
    const aliceOpenedSeatAt = hoursBeforeSessionStart(10);
    const choiceChangeAttemptedAt = hoursBeforeSessionStart(9);
    const source = createTestSession({ committedUserIds: ["alice"] });
    const committed = source.participantList.requireParticipation("p-alice");
    const withdrawn = committed.withdraw(
      committed.hold!.awaitReplacement(),
      aliceOpenedSeatAt,
      "OPEN_SLOT",
    );
    const bookingSession = new Session(
      sessionDetails({ participations: [withdrawn] }),
    );
    const changedChoice = new Participation({
      participationId: withdrawn.participationId,
      userId: withdrawn.userId,
      status: "WITHDRAWN",
      attendance: withdrawn.attendance,
      committedAt: withdrawn.committedAt,
      withdrawnAt: withdrawn.withdrawnAt,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "ben",
      hold: withdrawn.hold,
    });
    const previousList = bookingSession.participantList;
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(
        withdrawn,
        changedChoice,
        choiceChangeAttemptedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(bookingSession.participantList).toBe(previousList);
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenSourceIsStale_RejectsWithoutChangingState", () => {
    // Arrange
    const transitionAttemptedAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const removal = existing.remove(
      existing.hold!.refund(transitionAttemptedAt),
    );
    const withdrawn = existing.withdraw(
      existing.hold!.refund(transitionAttemptedAt),
      transitionAttemptedAt,
    );
    bookingSession.recordParticipationTransition(
      existing,
      withdrawn,
      transitionAttemptedAt,
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(
        existing,
        removal,
        transitionAttemptedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenReplacementChangesIdentity_RejectsWithoutChangingState", () => {
    // Arrange
    const removalAttemptedAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const foreign = committedParticipation(bookingSession, "other");
    const replacement = foreign.remove(
      foreign.hold!.refund(removalAttemptedAt),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(
        existing,
        replacement,
        removalAttemptedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenSessionIsCancelled_RejectsWithoutChangingState", () => {
    // Arrange
    const existing = Participation.createWaitlisted({
      participationId: "p-waiting",
      userId: "waiting",
      waitlistedAt: hoursBeforeSessionStart(48),
      queueSequence: 1,
    });
    const departed = existing.leaveWaitlist();
    const bookingSession = new Session(
      sessionDetails({
        status: "CANCELLED",
        participations: [existing.cancel()],
        nextQueueSequence: 2,
      }),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(existing, departed),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordCancellation_WhenCandidateOmitsAnOwnedParticipation_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const cancellationAttemptedAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const first =
      bookingSession.participantList.requireParticipation("p-alice");
    const cancelled = first.cancel(first.hold!.refund(cancellationAttemptedAt));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordCancellation([cancelled], cancellationAttemptedAt),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordCancellation_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const cancellationAttemptedAt = sessionStartsAt;
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const cancelled = existing.cancel(
      existing.hold!.refund(cancellationAttemptedAt),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordCancellation([cancelled], cancellationAttemptedAt),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenCandidateContainsDuplicateMarks_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const attendanceRecordedAt = sessionEndsAt;
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const verified = bookingSession.participantList
      .requireParticipation("p-alice")
      .verify("ATTENDED", "BOOKER", attendanceRecordedAt);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAttendance(
        [verified, verified],
        attendanceRecordedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenSessionHasNotEnded_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const attendanceAttemptedAt = hoursBeforeSessionStart(48);
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const verified = bookingSession.participantList
      .requireParticipation("p-alice")
      .verify("ATTENDED", "BOOKER", attendanceAttemptedAt);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAttendance([verified], attendanceAttemptedAt),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenLaterCandidateWasAlreadyVerified_LeavesAllMarksUnapplied", () => {
    // Arrange
    const attendanceRecordedAt = sessionEndsAt;
    const alreadyVerified = verifiedParticipation("alice", "ATTENDED");
    const source = createTestSession({ committedUserIds: ["ben"] });
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          alreadyVerified,
          ...source.participantList.participations,
        ],
      }),
    );
    const newMark = bookingSession.participantList
      .requireParticipation("p-ben")
      .verify("ATTENDED", "BOOKER", attendanceRecordedAt);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAttendance(
        [newMark, alreadyVerified],
        attendanceRecordedAt,
      ),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_CONFLICT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(
      bookingSession.participantList.requireParticipation("p-ben").attendance,
    ).toBe("UNVERIFIED");
  });

  test("recordSettlementPreparation_WhenSessionHasNotEnded_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordSettlementPreparation(
        {
          payoutId: "out",
          idempotencyKey: "key",
          participations: [],
        },
        hoursBeforeSessionStart(48),
      ),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordSettlementPreparation_WhenPayableHoldsHaveNoBatch_LeavesRosterAndHistoryUnchanged", () => {
    // Arrange
    const bookingSession = new Session(
      sessionDetails({
        status: "AWAITING_PAYOUT",
        participations: [verifiedParticipation("alice", "ATTENDED")],
      }),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordSettlementPreparation(
        {
          payoutId: "out",
          idempotencyKey: "key",
          participations: bookingSession.participantList.participations,
        },
        sessionEndsAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordSettlementPreparation_WhenBatchOmitsPayableHold_LeavesRosterAndHistoryUnchanged", () => {
    // Arrange
    const details = pendingPayoutDetails(["alice", "ben"]);
    const batch = details.pendingSettlement!;
    const bookingSession = new Session(
      sessionDetails({
        status: "AWAITING_PAYOUT",
        participations: details.participations,
      }),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordSettlementPreparation(
        {
          payoutId: "out",
          idempotencyKey: "key",
          participations: bookingSession.participantList.participations,
          batch: { ...batch, lines: batch.lines.slice(0, 1) },
        },
        sessionEndsAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});

function awaitingReplacementParticipation(
  userId: string,
  withdrawnAt: Date,
): Participation {
  const committedAt = hoursBeforeSessionStart(48);
  return new Participation({
    participationId: `p-${userId}`,
    userId,
    status: "WITHDRAWN",
    attendance: "UNVERIFIED",
    committedAt,
    withdrawnAt,
    replacementMode: "OPEN_SLOT",
    hold: new FundHold({
      holdId: `h-${userId}`,
      participationId: `p-${userId}`,
      holdingAccountId: "platform",
      walletId: `w-${userId}`,
      amount: Money.fromCents(500),
      state: "AWAITING_REPLACEMENT",
      createdAt: committedAt,
    }),
  });
}
