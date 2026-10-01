import { DomainError, FundHold, Participation, Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  sessionEndsAt,
  pendingPayoutDetails,
  createTestSession,
  sessionDetails,
  sessionStartsAt,
} from "./session-fixtures";

describe("Session", () => {
  describe("Construction and isolation", () => {
    test("constructor_WhenInputsAndGettersAreMutated_PreservesRosterAndHistory", () => {
      // Arrange
      const committedAt = hoursBeforeSessionStart(48);
      const source = createTestSession({ committedUserIds: ["alice"] });
      const participations = [...source.participantList.participations];
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
      (constructed.participantList.participations as Participation[]).pop();
      (constructed.payoutAttemptIds as string[]).pop();
      (constructed.payoutIdempotencyKeys as string[]).pop();
      constructed.booking.startAt.setFullYear(2000);
      child.committedAt?.setFullYear(2000);
      child.hold?.createdAt.setFullYear(2000);

      // Assert
      expect(constructed.participantList.participations).toHaveLength(1);
      expect(constructed.participantList.requireParticipation("p-alice")).toBe(
        child,
      );
      expect(constructed.booking.startAt).toEqual(sessionStartsAt);
      expect(child.committedAt).toEqual(committedAt);
      expect(child.hold?.createdAt).toEqual(committedAt);
      expect(constructed.payoutAttemptIds).toEqual(["earlier"]);
      expect(constructed.payoutIdempotencyKeys).toEqual(["earlier-key"]);
      expect(constructed.participantList.nextQueueSequence).toBe(1);
    });

    test("constructor_WhenBothHistoriesAreOmittedWithoutPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...sessionDetails(),
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: undefined,
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error Verify omitted histories fail at the runtime construction boundary.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenAttemptHistoryIsOmittedWithoutPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...sessionDetails(),
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: ["earlier-key"],
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error Verify omitted attempt history fails at the runtime construction boundary.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenKeyHistoryIsOmittedWithoutPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...sessionDetails(),
        payoutAttemptIds: ["earlier"],
        payoutIdempotencyKeys: undefined,
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error Verify omitted key history fails at the runtime construction boundary.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenAttemptHistoryIsNotAnArray_ThrowsInvalidInput", () => {
      // Arrange
      const details = { ...sessionDetails(), payoutAttemptIds: "earlier" };

      // Act & Assert
      expect(() => {
        // @ts-expect-error Verify the required history collection is rejected before Set conversion.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenKeyHistoryIsNotAnArray_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...sessionDetails(),
        payoutIdempotencyKeys: "earlier-key",
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error Verify the required history collection is rejected before Set conversion.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenBothHistoriesAreOmittedWithPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...pendingPayoutDetails(),
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: undefined,
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error A pending batch must not fill omitted histories at runtime.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenAttemptHistoryIsOmittedWithPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...pendingPayoutDetails(),
        payoutAttemptIds: undefined,
        payoutIdempotencyKeys: ["earlier-key", "key"],
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error A pending batch must not fill omitted attempt history at runtime.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenKeyHistoryIsOmittedWithPendingPayout_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        ...pendingPayoutDetails(),
        payoutAttemptIds: ["earlier", "out"],
        payoutIdempotencyKeys: undefined,
      };

      // Act & Assert
      expect(() => {
        // @ts-expect-error A pending batch must not fill omitted key history at runtime.
        return new Session(details);
      }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    });

    test("constructor_WhenSessionIsSettled_RestoresStatusAndEndTime", () => {
      // Arrange
      const details = sessionDetails({ status: "SETTLED" });

      // Act
      const restoredSession = new Session(details);

      // Assert
      expect(restoredSession.status).toBe("SETTLED");
      expect(restoredSession.booking.endAt).toEqual(sessionEndsAt);
    });

    test("constructor_WhenFailedPayoutHistoryIsRestored_PreservesAttemptsAndKeys", () => {
      // Arrange
      const details = {
        ...pendingPayoutDetails(),
        status: "AWAITING_PAYOUT" as const,
        pendingSettlement: undefined,
      };

      // Act
      const restoredSession = new Session(details);

      // Assert
      expect(restoredSession.status).toBe("AWAITING_PAYOUT");
      expect(restoredSession.pendingSettlement).toBeUndefined();
      expect(restoredSession.payoutAttemptIds).toEqual(["out"]);
      expect(restoredSession.payoutIdempotencyKeys).toEqual(["key"]);
      expect(
        restoredSession.participantList.requireParticipation("p-alice").hold
          ?.state,
      ).toBe("HELD");
    });

    test("constructor_WhenRosterIsDuplicated_ThrowsDomainError", () => {
      // Arrange
      const source = createTestSession({ committedUserIds: ["alice"] });
      const roster = source.participantList.participations;
      const details = sessionDetails({
        participations: [...roster, ...roster],
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenDifferentUsersShareParticipationId_ThrowsDuplicateId", () => {
      // Arrange
      const waitlistedAt = hoursBeforeSessionStart(48);
      const alice = Participation.createWaitlisted({
        participationId: "p-shared",
        userId: "alice",
        waitlistedAt,
        queueSequence: 1,
      });
      const ben = Participation.createWaitlisted({
        participationId: "p-shared",
        userId: "ben",
        waitlistedAt,
        queueSequence: 2,
      });
      const details = sessionDetails({
        participations: [alice, ben],
        nextQueueSequence: 3,
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(
        expect.objectContaining({ code: "DUPLICATE_ID" }),
      );
    });

    test("constructor_WhenDifferentParticipationsShareUserId_ThrowsDuplicateId", () => {
      // Arrange
      const waitlistedAt = hoursBeforeSessionStart(48);
      const firstEntry = Participation.createWaitlisted({
        participationId: "p-alice-first",
        userId: "alice",
        waitlistedAt,
        queueSequence: 1,
      });
      const secondEntry = Participation.createWaitlisted({
        participationId: "p-alice-second",
        userId: "alice",
        waitlistedAt,
        queueSequence: 2,
      });
      const details = sessionDetails({
        participations: [firstEntry, secondEntry],
        nextQueueSequence: 3,
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(
        expect.objectContaining({ code: "DUPLICATE_ID" }),
      );
    });

    test("constructor_WhenDifferentParticipationsShareHoldId_ThrowsDuplicateId", () => {
      // Arrange
      const benCommittedAt = hoursBeforeSessionStart(48);
      const source = createTestSession({ committedUserIds: ["alice"] });
      const alice = source.participantList.requireParticipation("p-alice");
      const ben = Participation.createCommitted({
        participationId: "p-ben",
        userId: "ben",
        committedAt: benCommittedAt,
        hold: FundHold.create({
          holdId: "h-alice",
          participationId: "p-ben",
          holdingAccountId: source.holdingAccountId,
          walletId: "w-ben",
          amount: source.bookingShare,
          createdAt: benCommittedAt,
        }),
      });
      const details = sessionDetails({ participations: [alice, ben] });

      // Act & Assert
      expect(() => new Session(details)).toThrow(
        expect.objectContaining({ code: "DUPLICATE_ID" }),
      );
    });

    test("constructor_WhenWaiterReusesHistoricalQueueSequence_ThrowsDuplicateId", () => {
      // Arrange
      const waitlistedAt = hoursBeforeSessionStart(48);
      const departedAlice = Participation.createWaitlisted({
        participationId: "p-alice",
        userId: "alice",
        waitlistedAt,
        queueSequence: 1,
      }).leaveWaitlist();
      const ben = Participation.createWaitlisted({
        participationId: "p-ben",
        userId: "ben",
        waitlistedAt,
        queueSequence: 1,
      });
      const details = sessionDetails({
        participations: [departedAlice, ben],
        nextQueueSequence: 2,
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(
        expect.objectContaining({ code: "DUPLICATE_ID" }),
      );
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
        waitlistedAt: hoursBeforeSessionStart(48),
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
      const source = createTestSession({ committedUserIds: ["alice"] });
      const roster = source.participantList.participations;
      const details = sessionDetails({
        participations: roster,
        status: "SETTLED",
      });

      // Act & Assert
      expect(() => new Session(details)).toThrow(DomainError);
    });

    test("constructor_WhenHoldUsesForeignAccount_ThrowsDomainError", () => {
      // Arrange
      const source = createTestSession({ committedUserIds: ["alice"] });
      const roster = source.participantList.participations;
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
        waitlistedAt: hoursBeforeSessionStart(48),
        queueSequence: 5,
      });
      const details = sessionDetails({
        participations: [queued],
        nextQueueSequence: 6,
      });

      // Act
      const restoredSession = new Session(details);

      // Assert
      expect(restoredSession.participantList.nextWaitlisted()?.userId).toBe(
        "queued-user",
      );
    });

    test("constructor_WhenPendingBatchBelongsToAnotherSession_ThrowsDomainError", () => {
      // Arrange
      const details = pendingPayoutDetails();
      const batch = details.pendingSettlement!;

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
      const details = pendingPayoutDetails();
      const batch = details.pendingSettlement!;

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
      const details = pendingPayoutDetails();

      // Act & Assert
      expect(() => new Session({ ...details, payoutAttemptIds: [] })).toThrow(
        DomainError,
      );
    });

    test("constructor_WhenPendingKeyIsMissingFromHistory_ThrowsDomainError", () => {
      // Arrange
      const details = pendingPayoutDetails();

      // Act & Assert
      expect(
        () => new Session({ ...details, payoutIdempotencyKeys: [] }),
      ).toThrow(DomainError);
    });

    test("pendingSettlement_WhenInputsAndOutputsAreMutated_PreservesBatchAndHistory", () => {
      // Arrange
      const details = pendingPayoutDetails();
      const batch = details.pendingSettlement!;
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
      expect(restoredSession.pendingSettlement?.requestedAt).toEqual(
        sessionEndsAt,
      );
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
      const details = pendingPayoutDetails();
      const source = new Session(details);
      const restoredSession = new Session(details);

      // Act
      const completion = restoredSession.completeSettlement(
        "out",
        sessionEndsAt,
      );

      // Assert
      expect(completion.instructions.map((line) => line.kind)).toEqual([
        "RELEASE",
      ]);
      expect(restoredSession.status).toBe("SETTLED");
      expect(source.status).toBe("PAYOUT_PENDING");
      expect(
        source.participantList.requireParticipation("p-alice").hold?.state,
      ).toBe("HELD");
    });
  });
});
