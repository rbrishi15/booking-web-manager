import { describe, expect, it } from "vitest";
import { Money } from "../../../domain/finance/money";
import { Payout } from "../../../domain/finance/payout";
import type { SettlementBatch } from "../../../domain/shared/operations";

const requestedAt = new Date("2026-10-10T12:00:00Z");
function batch(): SettlementBatch {
  return {
    payoutId: "payout",
    sessionId: "session",
    idempotencyKey: "key",
    requestedAt,
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

describe("Payout aggregate", () => {
  it("freezes the requested batch and has idempotent terminal callbacks", () => {
    // Arrange
    const source = batch();
    const payout = Payout.create(source);

    // Act
    source.requestedAt.setTime(0);
    const amount = payout.amount.toCents();
    const completed = payout.complete("provider-result", requestedAt);
    const repeatedCompletion = payout.complete("provider-result", requestedAt);
    const conflictingCompletion = () =>
      payout.complete("other-result", requestedAt);
    const reconstituted = Payout.reconstitute(payout.snapshot());

    // Assert
    expect(amount).toBe(100);
    expect(completed).toBe(true);
    expect(repeatedCompletion).toBe(false);
    expect(conflictingCompletion).toThrow();
    expect(reconstituted.status).toBe("COMPLETED");
  });

  it("keeps failed attempts terminal and records a durable request intent", () => {
    // Arrange
    const payout = Payout.create(batch());

    // Act
    const intent = payout.requestedIntent();
    const failed = payout.fail("timeout", requestedAt);
    const repeatedFailure = payout.fail("timeout", requestedAt);
    const lateCompletion = () => payout.complete("late", requestedAt);

    // Assert
    expect(intent).toMatchObject({
      kind: "PAYOUT_REQUESTED",
      payoutId: "payout",
      amount: Money.fromCents(100),
    });
    expect(failed).toBe(true);
    expect(repeatedFailure).toBe(false);
    expect(lateCompletion).toThrow();
  });
});
