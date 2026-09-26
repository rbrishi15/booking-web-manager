import { Money } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  at,
  createTestUser,
  destination,
  end,
  readyBooker,
  createTestSession,
  sessionState,
} from "../../sessions/session/session-fixtures";
import { readyBookerUser } from "../user-fixtures";

describe("Booker", () => {
  test("prepareSettlement_WhenRoleWasCreatedBeforeDeactivation_RejectsWithoutChangingState", () => {
    // Arrange
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
      booker.prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenAttendanceIsIncomplete_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-alice", attendance: "ATTENDED" }],
      now: end,
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenHoldsNeedReleaseAndForfeiture_KeepsFundsPending", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    const batch = readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });

    // Assert
    expect(bookingSession.status).toBe("PAYOUT_PENDING");
    expect(batch?.destination).toEqual(destination);
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(
      bookingSession.participations.map(
        (participation) => participation.hold?.state,
      ),
    ).toEqual(["FORFEITURE_DUE", "HELD"]);
  });

  test("prepareSettlement_WhenAnotherPayoutIsPending_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: end,
    });
    readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "another",
        idempotencyKey: "key2",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "PAYOUT_IN_PROGRESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenFailedPayoutIdIsReused_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: end,
    });
    readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });
    bookingSession.failSettlement("out", end);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "new",
        now: end,
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("prepareSettlement_WhenFailedPayoutKeyIsReusedWithNewPayoutId_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [
        { participationId: "p-alice", attendance: "ATTENDED" },
        { participationId: "p-ben", attendance: "ATTENDED" },
      ],
      now: end,
    });
    readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });
    bookingSession.failSettlement("out", end);
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "retry",
        idempotencyKey: "key",
        now: end,
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

  test("prepareSettlement_WhenSessionHasNoHolds_SettlesWithoutPayout", () => {
    // Arrange
    const bookingSession = createTestSession();

    // Act
    const batch = readyBooker().prepareSettlement(bookingSession, {
      payoutId: "unused",
      idempotencyKey: "unused",
      now: end,
    });
    const status = bookingSession.status;

    // Assert
    expect(batch).toBeUndefined();
    expect(status).toBe("SETTLED");
  });

  test("prepareSettlement_WhenReplacementSweepWasMissed_ExpiresOutstandingReplacement", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });

    // Act
    bookingSession.expireReplacements(at(1));
    const batch = readyBooker().prepareSettlement(bookingSession, {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    });

    // Assert
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "FORFEITURE_DUE",
    );
    expect(batch?.lines).toMatchObject([{ kind: "FORFEIT" }]);
  });

  test("prepareSettlement_WhenAttendanceIsIncomplete_LeavesExpiryUnapplied", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    };
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker().prepareSettlement(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("prepareSettlement_WhenBookerIsForeign_LeavesExpiryAndHistoryUnapplied", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: end,
    });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    };
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("foreign").prepareSettlement(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.payoutAttemptIds).toEqual([]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual([]);
  });

  test("prepareSettlement_WhenOwningBookerRetriesAfterForeignBooker_AppliesExpiryAndRecordsAttempt", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(2) });
    readyBooker().verifyAttendance(bookingSession, {
      marks: [{ participationId: "p-ben", attendance: "ATTENDED" }],
      now: end,
    });
    const command = {
      payoutId: "out",
      idempotencyKey: "key",
      now: end,
    };

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      readyBooker("foreign").prepareSettlement(bookingSession, command),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));

    expect(sessionState(bookingSession)).toEqual(previousState);

    // Act
    const batch = readyBooker().prepareSettlement(bookingSession, command);

    // Assert
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(bookingSession.participations[0]?.hold?.state).toBe(
      "FORFEITURE_DUE",
    );
    expect(bookingSession.payoutAttemptIds).toEqual(["out"]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual(["key"]);
  });
});
