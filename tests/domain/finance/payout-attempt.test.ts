import {
  DomainError,
  Money,
  PayoutAttempt,
  type PayoutAttemptDetails,
  type PayoutBatch,
} from "@/domain";
import { describe, expect, test } from "vitest";

const requestedAt = new Date("2026-10-10T12:00:00Z");

describe("PayoutAttempt", () => {
  describe("Construction and isolation", () => {
    test("constructor_WhenCompletionMetadataIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(() => new PayoutAttempt({ ...details, status: "COMPLETED" })).toThrow(
        DomainError,
      );
    });

    test("constructor_WhenCompletedProviderReferenceIsBlank_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () =>
          new PayoutAttempt({
            ...details,
            status: "COMPLETED",
            completedAt: requestedAt,
            providerReference: " ",
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenFailureReasonIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () =>
          new PayoutAttempt({ ...details, status: "FAILED", failedAt: requestedAt }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenFailedPayoutHasCompletionDate_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () =>
          new PayoutAttempt({
            ...details,
            status: "FAILED",
            failedAt: requestedAt,
            failureReason: "failure",
            completedAt: requestedAt,
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenRequestedPayoutHasCompletionDate_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () => new PayoutAttempt({ ...details, completedAt: requestedAt }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenRequestedPayoutHasProviderReference_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () => new PayoutAttempt({ ...details, providerReference: "provider" }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenAmountDoesNotMatchLines_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () => new PayoutAttempt({ ...details, amount: Money.fromCents(99) }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenAccountDoesNotMatchDestination_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () => new PayoutAttempt({ ...details, payoutAccountId: "foreign" }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenLinesAreEmpty_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(() => new PayoutAttempt({ ...details, lines: [] })).toThrow(DomainError);
    });

    test("constructor_WhenLinesAreDuplicated_ThrowsDomainError", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };

      // Act & Assert
      expect(
        () =>
          new PayoutAttempt({
            ...details,
            lines: [...details.lines, ...details.lines],
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenNestedInputsAndOutputsAreMutated_PreservesSettlementData", () => {
      // Arrange
      const source = batch();
      const completedAt = new Date(requestedAt);
      const payout = new PayoutAttempt({
        ...source,
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "COMPLETED",
        completedAt,
        providerReference: "provider",
      });

      // Act
      completedAt.setTime(0);
      payout.completedAt?.setTime(0);
      (
        source.destination as { bankAccountReference: string }
      ).bankAccountReference = "changed";
      (source.lines as unknown[]).pop();
      (
        payout.destination as { bankAccountReference: string }
      ).bankAccountReference = "changed";
      (payout.lines as unknown[]).pop();

      // Assert
      expect(payout.completedAt).toEqual(requestedAt);
      expect(payout.destination.bankAccountReference).toBe("bank");
      expect(payout.lines).toHaveLength(1);
      expect(payout.lines[0]?.amount.toCents()).toBe(100);
    });

    test("create_WhenRequestDateIsMutated_PreservesRequestedBatch", () => {
      // Arrange
      const source = batch();
      const payout = PayoutAttempt.create(source);

      // Act
      source.requestedAt.setTime(0);
      payout.requestedAt.setTime(0);

      // Assert
      expect(payout.amount.toCents()).toBe(100);
      expect(payout.requestedAt).toEqual(requestedAt);
    });
  });

  describe("Request intent", () => {
    test("requestedIntent_WhenPayoutIsRequested_ContainsDurableRequestDetails", () => {
      // Arrange
      const payout = PayoutAttempt.create(batch());

      // Act
      const intent = payout.requestedIntent();

      // Assert
      expect(intent).toMatchObject({
        kind: "PAYOUT_REQUESTED",
        payoutId: "payout",
        amount: Money.fromCents(100),
      });
    });
  });

  describe("Completion", () => {
    test("complete_WhenRestoredPayoutHasFailed_ThrowsStalePayout", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };
      const payout = new PayoutAttempt({
        ...details,
        status: "FAILED",
        failedAt: requestedAt,
        failureReason: "failure",
      });

      // Act & Assert
      expect(() => payout.complete("provider", requestedAt)).toThrow(
        expect.objectContaining({ code: "STALE_PAYOUT" }),
      );
    });

    test("complete_WhenSameCallbackIsRepeated_CompletesOnlyOnce", () => {
      // Arrange
      const payout = PayoutAttempt.create(batch());

      // Act
      const completed = payout.complete("provider-result", requestedAt);
      const repeatedCompletion = payout.complete(
        "provider-result",
        requestedAt,
      );

      // Assert
      expect(completed).toBe(true);
      expect(repeatedCompletion).toBe(false);
    });

    test("complete_WhenProviderReferenceConflicts_ThrowsPayoutConflict", () => {
      // Arrange
      const payout = PayoutAttempt.create(batch());
      payout.complete("provider-result", requestedAt);

      // Act & Assert
      expect(() => payout.complete("other-result", requestedAt)).toThrow(
        expect.objectContaining({ code: "PAYOUT_CONFLICT" }),
      );
    });

    test("complete_WhenRestoredCompletionMatches_ReturnsFalse", () => {
      // Arrange
      const payout = new PayoutAttempt({
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "COMPLETED",
        completedAt: requestedAt,
        providerReference: "provider-result",
      });

      // Act
      const repeatedCompletion = payout.complete(
        "provider-result",
        requestedAt,
      );

      // Assert
      expect(payout.status).toBe("COMPLETED");
      expect(payout.amount.toCents()).toBe(100);
      expect(payout.providerReference).toBe("provider-result");
      expect(repeatedCompletion).toBe(false);
    });

    test("complete_WhenFailureHasBeenRecorded_RejectsLateCallback", () => {
      // Arrange
      const payout = PayoutAttempt.create(batch());
      payout.fail("timeout", requestedAt);

      // Act & Assert
      expect(() => payout.complete("late", requestedAt)).toThrow(
        expect.objectContaining({ code: "STALE_PAYOUT" }),
      );
    });
  });

  describe("Failure", () => {
    test("fail_WhenRestoredFailureMatches_ReturnsFalse", () => {
      // Arrange
      const details: PayoutAttemptDetails = {
        ...batch(),
        payoutAccountId: "account",
        amount: Money.fromCents(100),
        status: "REQUESTED",
      };
      const payout = new PayoutAttempt({
        ...details,
        status: "FAILED",
        failedAt: requestedAt,
        failureReason: "failure",
      });

      // Act
      const repeatedFailure = payout.fail("failure", requestedAt);

      // Assert
      expect(repeatedFailure).toBe(false);
    });

    test("fail_WhenSameCallbackIsRepeated_FailsOnlyOnce", () => {
      // Arrange
      const payout = PayoutAttempt.create(batch());

      // Act
      const failed = payout.fail("timeout", requestedAt);
      const repeatedFailure = payout.fail("timeout", requestedAt);

      // Assert
      expect(failed).toBe(true);
      expect(repeatedFailure).toBe(false);
    });
  });
});

function batch(): PayoutBatch {
  return {
    payoutId: "payout",
    sessionId: "session",
    idempotencyKey: "key",
    requestedAt: new Date(requestedAt),
    destination: {
      payoutAccountId: "account",
      userId: "booker",
      providerAccountReference: "provider",
      bankAccountReference: "bank",
    },
    lines: [
      {
        holdId: "hold",
        participationId: "participation",
        holdingAccountId: "platform",
        walletId: "wallet",
        amount: Money.fromCents(100),
        kind: "RELEASE",
      },
    ],
  };
}
