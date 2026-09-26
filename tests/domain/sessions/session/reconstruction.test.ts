import { DomainError, Participation, Session } from "@/domain";
import { describe, expect, test, vi } from "vitest";
import {
  before,
  end,
  join,
  readyBooker,
  session,
  sessionDetails,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  describe("Construction and isolation", () => {
    test("constructor_WhenInputsAndGettersAreMutated_PreservesRosterAndHistory", () => {
      // Arrange
      const source = session();
      join(source, "a");
      const participations = [...source.participations];
      const attemptIds = ["earlier"];
      const keys = ["earlier-key"];
      const constructed = new Session(
        sessionDetails({
          participations,
          payoutAttemptIds: attemptIds,
          payoutIdempotencyKeys: keys,
        }),
      );
      const child = participations[0]!;

      // Act
      participations.pop();
      attemptIds.push("leak");
      keys.push("leak");
      (constructed.participations as Participation[]).pop();
      (constructed.payoutAttemptIds as string[]).pop();
      (constructed.payoutIdempotencyKeys as string[]).pop();
      constructed.booking.startAt.setFullYear(2000);
      child.committedAt?.setFullYear(2000);
      child.hold?.createdAt.setFullYear(2000);

      // Assert
      expect(constructed.participations).toHaveLength(1);
      expect(constructed.participations[0]).toBe(child);
      expect(constructed.booking.startAt).toEqual(start);
      expect(child.committedAt).toEqual(before);
      expect(child.hold?.createdAt).toEqual(before);
      expect(constructed.payoutAttemptIds).toEqual(["earlier"]);
      expect(constructed.payoutIdempotencyKeys).toEqual(["earlier-key"]);
      expect(constructed.nextQueueSequence).toBe(1);
    });

    test("constructor_WhenBothHistoriesAreOmittedWithoutPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const details = sessionDetails({
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: undefined,
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual([]);
      expect(restored.payoutIdempotencyKeys).toEqual([]);
    });

    test("constructor_WhenAttemptHistoryIsOmittedWithoutPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const details = sessionDetails({
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: ["earlier-key"],
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual([]);
      expect(restored.payoutIdempotencyKeys).toEqual(["earlier-key"]);
    });

    test("constructor_WhenKeyHistoryIsOmittedWithoutPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const details = sessionDetails({
        payoutAttemptIds: ["earlier"],
        payoutIdempotencyKeys: undefined,
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual(["earlier"]);
      expect(restored.payoutIdempotencyKeys).toEqual([]);
    });

    test("constructor_WhenBothHistoriesAreOmittedWithPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: undefined,
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual(["out"]);
      expect(restored.payoutIdempotencyKeys).toEqual(["key"]);
    });

    test("constructor_WhenAttemptHistoryIsOmittedWithPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: ["earlier-key", "key"],
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual(["out"]);
      expect(restored.payoutIdempotencyKeys).toEqual(["earlier-key", "key"]);
    });

    test("constructor_WhenKeyHistoryIsOmittedWithPendingPayout_DefaultsOnlyMissingHistory", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: ["earlier", "out"],
        payoutIdempotencyKeys: undefined,
      });

      // Act
      const restored = new Session(details);

      // Assert
      expect(restored.payoutAttemptIds).toEqual(["earlier", "out"]);
      expect(restored.payoutIdempotencyKeys).toEqual(["key"]);
    });

    test("constructor_WhenSessionIsSettled_RestoresStatusAndEndTime", () => {
      // Arrange
      const details = sessionDetails({ status: "SETTLED" });

      // Act
      const restoredSession = new Session(details);

      // Assert
      expect(restoredSession.status).toBe("SETTLED");
      expect(restoredSession.booking.endAt).toEqual(end);
    });

    test("constructor_WhenRosterIsDuplicated_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      const roster = source.participations;
      const details = sessionDetails({
        participations: [...roster, ...roster],
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenPendingPayoutHasNoBatch_ThrowsDomainError", () => {
      // Arrange

      const details = sessionDetails({ status: "PAYOUT_PENDING" });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenNextSequenceDoesNotFollowQueue_ThrowsDomainError", () => {
      // Arrange
      const queued = Participation.createWaitlisted({
        participationId: "queued",
        userId: "queued-user",
        waitlistedAt: before,
        queueSequence: 5,
      });
      const details = sessionDetails({
        participations: [queued],
        nextQueueSequence: 5,
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenSettledRosterStillHasHeldFunds_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      const roster = source.participations;
      const details = sessionDetails({
        participations: roster,
        status: "SETTLED",
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenHoldUsesForeignAccount_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      const roster = source.participations;
      const details = sessionDetails({
        participations: roster,
        holdingAccountId: "foreign",
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenPayoutAttemptIdsAreDuplicated_ThrowsDomainError", () => {
      // Arrange

      const details = sessionDetails({ payoutAttemptIds: ["same", "same"] });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenPayoutKeysAreDuplicated_ThrowsDomainError", () => {
      // Arrange

      const details = sessionDetails({
        payoutIdempotencyKeys: ["same", "same"],
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenNextSequenceFollowsQueue_RestoresNextWaiter", () => {
      // Arrange
      const queued = Participation.createWaitlisted({
        participationId: "queued",
        userId: "queued-user",
        waitlistedAt: before,
        queueSequence: 5,
      });
      const details = sessionDetails({
        participations: [queued],
        nextQueueSequence: 6,
      });

      // Act
      const restoredSession = new Session(details);

      // Assert
      expect(restoredSession.nextWaitlistedUserId).toBe("queued-user");
    });

    test("constructor_WhenPendingBatchBelongsToAnotherSession_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });

      // Act & Assert
      expect(
        () =>
          new Session({
            ...details,
            pendingSettlement: { ...batch, sessionId: "foreign" },
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenPendingLineUsesForeignWallet_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });

      // Act & Assert
      expect(
        () =>
          new Session({
            ...details,
            pendingSettlement: {
              ...batch,
              lines: [{ ...batch.lines[0]!, walletId: "foreign" }],
            },
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenPendingAttemptIsMissingFromHistory_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });

      // Act & Assert
      expect(() => new Session({ ...details, payoutAttemptIds: [] })).toThrow(
        DomainError,
      );
    });

    test("constructor_WhenPendingKeyIsMissingFromHistory_ThrowsDomainError", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });

      // Act & Assert
      expect(
        () => new Session({ ...details, payoutIdempotencyKeys: [] }),
      ).toThrow(DomainError);
    });

    test("pendingSettlement_WhenInputsAndOutputsAreMutated_PreservesBatchAndHistory", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });
      const restoredSession = new Session(details);

      // Act
      batch.requestedAt.setFullYear(2000);
      (
        batch.destination as { bankAccountReference: string }
      ).bankAccountReference = "changed";
      (batch.lines as unknown[]).pop();
      restoredSession.pendingSettlement?.requestedAt.setFullYear(2001);
      const exposed = restoredSession.pendingSettlement!;
      (
        exposed.destination as { bankAccountReference: string }
      ).bankAccountReference = "changed-again";
      (exposed.lines as unknown[]).pop();

      // Assert
      expect(restoredSession.pendingSettlement?.requestedAt).toEqual(end);
      expect(
        restoredSession.pendingSettlement?.destination.bankAccountReference,
      ).toBe("bank");
      expect(restoredSession.pendingSettlement?.lines).toHaveLength(1);
      expect(
        restoredSession.pendingSettlement?.lines[0]?.amount.toCents(),
      ).toBe(500);
      expect(restoredSession.payoutAttemptIds).toEqual(["out"]);
      expect(restoredSession.payoutIdempotencyKeys).toEqual(["key"]);
    });
  });

  describe("Settlement completion", () => {
    test("completeSettlement_WhenPendingSessionIsRestored_SettlesIndependentlyOfSource", () => {
      // Arrange
      const source = session();
      join(source, "a");
      readyBooker().verifyAttendance(source, {
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: end,
      });
      const batch = readyBooker().prepareSettlement(source, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      })!;
      const details = sessionDetails({
        status: "PAYOUT_PENDING",
        participations: source.participations,
        pendingSettlement: batch,
        payoutAttemptIds: source.payoutAttemptIds,
        payoutIdempotencyKeys: source.payoutIdempotencyKeys,
      });
      const restoredSession = new Session(details);

      // Act
      const completion = restoredSession.completeSettlement("out", end);

      // Assert
      expect(completion.instructions.map((line) => line.kind)).toEqual([
        "RELEASE",
      ]);
      expect(restoredSession.status).toBe("SETTLED");
      expect(source.status).toBe("PAYOUT_PENDING");
      expect(source.participations[0]?.hold?.state).toBe("HELD");
    });

    test("completeSettlement_WhenCallbackIsStale_LeavesAllHoldsPending", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      readyBooker().verifyAttendance(bookingSession, {
        marks: [
          { participationId: "p-a", attendance: "ATTENDED" },
          { participationId: "p-b", attendance: "ATTENDED" },
        ],
        now: end,
      });
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      });
      const previousState = sessionState(bookingSession);

      // Act & Assert
      expect(() => bookingSession.completeSettlement("stale", end)).toThrow(
        expect.objectContaining({ code: "STALE_PAYOUT" }),
      );
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("completeSettlement_WhenCompletionDateIsInvalid_LeavesAllHoldsPending", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      readyBooker().verifyAttendance(bookingSession, {
        marks: [
          { participationId: "p-a", attendance: "ATTENDED" },
          { participationId: "p-b", attendance: "ATTENDED" },
        ],
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
        bookingSession.completeSettlement("out", new Date(Number.NaN)),
      ).toThrow(DomainError);
      expect(sessionState(bookingSession)).toEqual(previousState);
    });

    test("completeSettlement_WhenSecondHoldFails_PreservesAllHoldsAndAllowsRetry", () => {
      // Arrange
      const bookingSession = session();
      join(bookingSession, "a");
      join(bookingSession, "b");
      readyBooker().verifyAttendance(bookingSession, {
        marks: [
          { participationId: "p-a", attendance: "ATTENDED" },
          { participationId: "p-b", attendance: "ATTENDED" },
        ],
        now: end,
      });
      readyBooker().prepareSettlement(bookingSession, {
        payoutId: "out",
        idempotencyKey: "key",
        now: end,
      });
      const previousState = sessionState(bookingSession);
      const failure = vi
        .spyOn(bookingSession.participations[1]!, "settleHold")
        .mockImplementationOnce(() => {
          throw new DomainError("INVALID_STATE", "Second line rejected");
        });

      // Act & Assert
      try {
        expect(() => bookingSession.completeSettlement("out", end)).toThrow(
          expect.objectContaining({
            code: "INVALID_STATE",
            message: "Second line rejected",
          }),
        );
        expect(sessionState(bookingSession)).toEqual(previousState);
      } finally {
        failure.mockRestore();
      }

      // Act
      const completion = bookingSession.completeSettlement("out", end);

      // Assert
      expect(completion.instructions).toHaveLength(2);
      expect(
        bookingSession.participations.map(
          (participation) => participation.hold?.state,
        ),
      ).toEqual(["RELEASED", "RELEASED"]);
      expect(bookingSession.pendingSettlement).toBeUndefined();
    });
  });
});
