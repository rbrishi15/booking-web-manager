import { Money, Session, type SessionDetails } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestUser,
  destination,
  sessionEndsAt,
  pendingPayoutDetails,
  readyBooker,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";
import { readyBookerUser } from "../user-fixtures";

describe("Booker", () => {
  test("preparePayout_WhenRoleWasCreatedBeforeDeactivation_RejectsWithoutChangingState", () => {
    // Arrange
    const payoutTime = sessionEndsAt;
    const owner = createTestUser({
      userId: "booker",
      availableFundsCents: 0,
      payoutAccount: readyBookerUser().payoutAccount,
    });
    const booker = owner.asBooker();
    owner.deactivate({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    });
    const bookingSession = createTestSession();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      booker.preparePayout(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenAttendanceIsIncomplete_RejectsWithoutChangingState", () => {
    // Arrange
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().preparePayout(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenHoldsNeedReleaseAndForfeiture_KeepsFundsPending", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });

    // Act
    const batch = readyBooker().preparePayout(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    });

    // Assert
    expect(bookingSession.status).toBe("PAYOUT_PENDING");
    expect(batch?.destination).toEqual(destination);
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["FORFEITURE_DUE", "HELD"]);
  });

  test("preparePayout_WhenAnotherPayoutIsPending_RejectsWithoutChangingState", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    readyBooker().preparePayout(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().preparePayout(bookingSession, {
        payoutId: "another",
        idempotencyKey: "key2",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "PAYOUT_IN_PROGRESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenFailedPayoutIdIsReused_RejectsWithoutChangingState", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const attendanceVerificationTime = sessionEndsAt;
    const payoutFailureTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    readyBooker().preparePayout(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    });
    bookingSession.failSettlement("out", payoutFailureTime);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().preparePayout(bookingSession, {
        payoutId: "out",
        idempotencyKey: "new",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenFailedPayoutKeyIsReusedWithNewPayoutId_RejectsWithoutChangingState", () => {
    // Arrange
    const attendanceVerificationTime = sessionEndsAt;
    const payoutFailureTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [
        { participationId: "p-alice", attendance: "ATTENDED" },
        { participationId: "p-ben", attendance: "ATTENDED" },
      ],
      now: attendanceVerificationTime,
    });
    readyBooker().preparePayout(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    });
    bookingSession.failSettlement("out", payoutFailureTime);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().preparePayout(bookingSession, {
        payoutId: "retry",
        idempotencyKey: "key",
        now: payoutTime,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "DUPLICATE_ID",
        message:
          "A payout idempotency key can only be used once for this session",
      }),
    );
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenFailedAttemptIsRetriedWithNewIdentity_RecordsRetry", () => {
    // Arrange
    const payoutFailureTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = new Session(pendingPayoutDetails(["alice", "ben"]));
    const aliceHold =
      bookingSession.participantList.requireParticipation("p-alice").hold;
    const benHold =
      bookingSession.participantList.requireParticipation("p-ben").hold;
    bookingSession.failSettlement("out", payoutFailureTime);
    const booker = readyBooker();

    // Act
    const retryBatch = booker.preparePayout(bookingSession, {
      payoutId: "retry",
      idempotencyKey: "retry-key",
      now: payoutTime,
    });

    // Assert
    expect(retryBatch?.payoutId).toBe("retry");
    expect(retryBatch?.idempotencyKey).toBe("retry-key");
    expect(bookingSession.status).toBe("PAYOUT_PENDING");
    expect(bookingSession.pendingSettlement?.payoutId).toBe("retry");
    expect(bookingSession.payoutAttemptIds).toEqual(["out", "retry"]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual(["key", "retry-key"]);
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold,
    ).toBe(aliceHold);
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold,
    ).toBe(benHold);
    expect(
      bookingSession.participantList.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["HELD", "HELD"]);
  });

  test("preparePayout_WhenSessionHasNoHolds_SettlesWithoutPayout", () => {
    // Arrange
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession();

    // Act
    const batch = readyBooker().preparePayout(bookingSession, {
      payoutId: "unused",
      idempotencyKey: "unused",
      now: payoutTime,
    });
    const status = bookingSession.status;

    // Assert
    expect(batch).toBeUndefined();
    expect(status).toBe("SETTLED");
  });

  test("preparePayout_WhenReplacementSweepWasMissed_ExpiresOutstandingReplacement", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });

    // Act
    const batch = readyBooker().preparePayout(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    });

    // Assert
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("FORFEITURE_DUE");
    expect(batch?.lines).toMatchObject([{ kind: "FORFEIT" }]);
  });

  test("preparePayout_WhenAttendanceIsIncomplete_LeavesExpiryUnapplied", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    };
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().preparePayout(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("AWAITING_REPLACEMENT");
  });

  test("preparePayout_WhenBookerIsForeign_LeavesExpiryAndHistoryUnapplied", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    };
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("foreign").preparePayout(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.payoutAttemptIds).toEqual([]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual([]);
  });

  test("preparePayout_WhenOwningBookerRetriesAfterForeignBooker_AppliesExpiryAndRecordsAttempt", () => {
    // Arrange
    const withdrawalTime = hoursBeforeSessionStart(2);
    const attendanceVerificationTime = sessionEndsAt;
    const payoutTime = sessionEndsAt;
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: withdrawalTime,
      });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: attendanceVerificationTime,
    });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: payoutTime,
    };

    // Establish a rejected foreign attempt before exercising the owner retry.
    expect(() =>
      readyBooker("foreign").preparePayout(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));

    // Act
    const batch = readyBooker().preparePayout(bookingSession, command);

    // Assert
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("FORFEITURE_DUE");
    expect(bookingSession.payoutAttemptIds).toEqual(["out"]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual(["key"]);
  });

  test("preparePayout_WhenFailedPayoutHistoryIsRestored_RejectsReusedPayoutId", () => {
    // Arrange
    const payoutTime = sessionEndsAt;
    const bookingSession = new Session({
      ...pendingPayoutDetails(),
      status: "AWAITING_PAYOUT",
      pendingSettlement: undefined,
    });
    const booker = readyBooker();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      booker.preparePayout(bookingSession, {
        payoutId: "out",
        idempotencyKey: "retry-key",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenFailedPayoutHistoryIsRestored_RejectsReusedIdempotencyKey", () => {
    // Arrange
    const payoutTime = sessionEndsAt;
    const bookingSession = new Session({
      ...pendingPayoutDetails(),
      status: "AWAITING_PAYOUT",
      pendingSettlement: undefined,
    });
    const booker = readyBooker();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      booker.preparePayout(bookingSession, {
        payoutId: "retry",
        idempotencyKey: "key",
        now: payoutTime,
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("preparePayout_WhenFailedPayoutHistoryIsRestored_AllowsNewIdentityIndependentlyOfSource", () => {
    // Arrange
    const payoutTime = sessionEndsAt;
    const details: SessionDetails = {
      ...pendingPayoutDetails(),
      status: "AWAITING_PAYOUT",
      pendingSettlement: undefined,
    };
    const source = new Session(details);
    const restoredSession = new Session(details);
    const sourceState = sessionState(source);
    const booker = readyBooker();

    // Act
    const retryBatch = booker.preparePayout(restoredSession, {
      payoutId: "retry",
      idempotencyKey: "retry-key",
      now: payoutTime,
    });

    // Assert
    expect(retryBatch?.payoutId).toBe("retry");
    expect(retryBatch?.idempotencyKey).toBe("retry-key");
    expect(restoredSession.status).toBe("PAYOUT_PENDING");
    expect(restoredSession.pendingSettlement?.payoutId).toBe("retry");
    expect(restoredSession.payoutAttemptIds).toEqual(["out", "retry"]);
    expect(restoredSession.payoutIdempotencyKeys).toEqual(["key", "retry-key"]);
    expect(sessionState(source)).toEqual(sourceState);
  });
});
