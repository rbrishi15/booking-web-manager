import { FundHold, Participation, Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  at,
  before,
  committedParticipation,
  createTestUser,
  end,
  readyBooker,
  createTestSession,
  sessionDetails,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("recordAdmission_WhenHoldIdIsDuplicated_PreservesListAndAllowsValidRetry", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousList = bookingSession.participantList;
    const alice = previousList.requireParticipation("p-alice");
    const previousState = sessionState(bookingSession);
    const invalidAdmission = Participation.createCommitted({
      participationId: "p-ben",
      userId: "ben",
      committedAt: before,
      hold: FundHold.create({
        holdId: "h-alice",
        participationId: "p-ben",
        holdingAccountId: bookingSession.holdingAccountId,
        walletId: "w-ben",
        amount: bookingSession.bookingShare,
        createdAt: before,
      }),
    });

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(invalidAdmission, undefined, before),
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

    // Act
    const validAdmission = committedParticipation(bookingSession, "ben");
    bookingSession.recordAdmission(validAdmission, undefined, before);

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
    const bookingSession = createTestSession();
    const admission = committedParticipation(bookingSession, "alice", start);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, start),
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
      bookingSession.recordAdmission(admission, undefined, before),
    ).toThrow(expect.objectContaining({ code: "CAPACITY_EXCEEDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenNewCommitmentBypassesFirstWaiter_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: before,
      });
    const admission = committedParticipation(bookingSession, "newcomer");
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, before),
    ).toThrow(expect.objectContaining({ code: "WAITLIST_NOT_HEAD" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "waiting",
    );
  });

  test("recordAdmission_WhenReturningWaiterChangesParticipationId_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    createTestUser({ userId: "waiting" })
      .asParticipant()
      .leaveWaitlist(bookingSession, {
        participationId: "p-waiting",
        now: before,
      });
    const admission = Participation.createWaitlisted({
      participationId: "p-new-waiting",
      userId: "waiting",
      waitlistedAt: before,
      queueSequence: bookingSession.participantList.nextQueueSequence,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, before),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenReplacementRefundIsMissing_LeavesCommitmentAndHeldFundsUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(10),
      });
    const candidate = committedParticipation(
      bookingSession,
      "replacement",
      at(9),
    );
    const admission = Participation.createCommitted({
      participationId: candidate.participationId,
      userId: candidate.userId,
      committedAt: at(9),
      hold: candidate.hold!,
      replacesParticipationId: "p-alice",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, undefined, at(9)),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAdmission_WhenRefundTargetsNewerWithdrawal_LeavesEntireRosterUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(10),
      });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(9),
      });
    const newer = bookingSession.participantList.requireParticipation("p-ben");
    const candidate = committedParticipation(
      bookingSession,
      "replacement",
      at(8),
    );
    const admission = Participation.createCommitted({
      participationId: candidate.participationId,
      userId: candidate.userId,
      committedAt: at(8),
      hold: candidate.hold!,
      replacesParticipationId: "p-alice",
    });
    const refund = newer.refundReplacement(at(8));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAdmission(admission, refund, at(8)),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenSourceIsStale_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const removal = existing.remove(existing.hold!.refund(before));
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: before,
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(existing, removal, before),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenReplacementChangesIdentity_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const foreign = committedParticipation(bookingSession, "other");
    const replacement = foreign.remove(foreign.hold!.refund(before));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(
        existing,
        replacement,
        before,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordParticipationTransition_WhenSessionIsCancelled_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["waiting"],
    });
    const existing =
      bookingSession.participantList.requireParticipation("p-waiting");
    const departed = existing.leaveWaitlist();
    readyBooker().cancel(bookingSession, before);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordParticipationTransition(existing, departed),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordCancellation_WhenCandidateOmitsAnOwnedParticipation_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const first =
      bookingSession.participantList.requireParticipation("p-alice");
    const cancelled = first.cancel(first.hold!.refund(before));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordCancellation([cancelled], before),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordCancellation_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const existing =
      bookingSession.participantList.requireParticipation("p-alice");
    const cancelled = existing.cancel(existing.hold!.refund(start));
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => bookingSession.recordCancellation([cancelled], start)).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenCandidateContainsDuplicateMarks_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const verified = bookingSession.participantList
      .requireParticipation("p-alice")
      .verify("ATTENDED", "BOOKER", end);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAttendance([verified, verified], end),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenSessionHasNotEnded_LeavesRosterAndStatusUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const verified = bookingSession.participantList
      .requireParticipation("p-alice")
      .verify("ATTENDED", "BOOKER", before);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() => bookingSession.recordAttendance([verified], before)).toThrow(
      expect.objectContaining({ code: "SESSION_NOT_ENDED" }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordAttendance_WhenLaterCandidateWasAlreadyVerified_LeavesAllMarksUnapplied", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });
    const alreadyVerified =
      bookingSession.participantList.requireParticipation("p-alice");
    const newMark = bookingSession.participantList
      .requireParticipation("p-ben")
      .verify("ATTENDED", "BOOKER", end);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordAttendance([newMark, alreadyVerified], end),
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
        before,
      ),
    ).toThrow(expect.objectContaining({ code: "SESSION_NOT_ENDED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordSettlementPreparation_WhenPayableHoldsHaveNoBatch_LeavesRosterAndHistoryUnchanged", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.recordSettlementPreparation(
        {
          payoutId: "out",
          idempotencyKey: "key",
          participations: bookingSession.participantList.participations,
        },
        end,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("recordSettlementPreparation_WhenBatchOmitsPayableHold_LeavesRosterAndHistoryUnchanged", () => {
    // Arrange
    const source = createTestSession({ committedUserIds: ["alice", "ben"] });
    readyBooker().verifyAttendance(source, {
      marks: [
        { participationId: "p-alice", attendance: "ATTENDED" },
        { participationId: "p-ben", attendance: "ATTENDED" },
      ],
      now: end,
    });
    const bookingSession = new Session(
      sessionDetails({
        status: source.status,
        participations: source.participantList.participations,
      }),
    );
    const batch = readyBooker().prepareSettlement(source, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    })!;
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
        end,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
