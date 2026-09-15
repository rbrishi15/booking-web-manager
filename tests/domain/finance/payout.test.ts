import {
  DomainError,
  Money,
  Payout,
  type PayoutDetails,
  type SettlementBatch,
} from "@/domain";
import { describe, expect, it } from "vitest";

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
  it("constructors validate lifecycle metadata and settlement totals", () => {
    const details: PayoutDetails = {
      ...batch(),
      payoutAccountId: "account",
      amount: Money.fromCents(100),
      status: "REQUESTED",
    };
    const invalid: Partial<PayoutDetails>[] = [
      { status: "COMPLETED" },
      { status: "COMPLETED", completedAt: requestedAt, providerReference: " " },
      { status: "FAILED", failedAt: requestedAt },
      {
        status: "FAILED",
        failedAt: requestedAt,
        failureReason: "failure",
        completedAt: requestedAt,
      },
      { completedAt: requestedAt },
      { providerReference: "provider" },
      { amount: Money.fromCents(99) },
      { payoutAccountId: "foreign" },
      { lines: [] },
      { lines: [...details.lines, ...details.lines] },
    ];
    for (const change of invalid)
      expect(() => new Payout({ ...details, ...change })).toThrow(DomainError);
    const failed = new Payout({
      ...details,
      status: "FAILED",
      failedAt: requestedAt,
      failureReason: "failure",
    });
    expect(failed.fail("failure", requestedAt)).toBe(false);
    expect(() => failed.complete("provider", requestedAt)).toThrow(DomainError);
  });

  it("constructors and getters protect nested settlement data and completion dates", () => {
    const source = batch();
    const completedAt = new Date(requestedAt);
    const payout = new Payout({
      ...source,
      payoutAccountId: "account",
      amount: Money.fromCents(100),
      status: "COMPLETED",
      completedAt,
      providerReference: "provider",
    });
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
    expect(payout.completedAt).toEqual(requestedAt);
    expect(payout.destination.bankAccountReference).toBe("bank");
    expect(payout.lines).toHaveLength(1);
    expect(payout.lines[0]?.amount.toCents()).toBe(100);
  });

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
    const constructed = new Payout({
      ...batch(),
      payoutAccountId: "account",
      amount: Money.fromCents(100),
      status: "COMPLETED",
      completedAt: requestedAt,
      providerReference: "provider-result",
    });

    // Assert
    expect(amount).toBe(100);
    expect(completed).toBe(true);
    expect(repeatedCompletion).toBe(false);
    expect(conflictingCompletion).toThrow();
    expect(constructed.status).toBe("COMPLETED");
    expect(constructed.amount.toCents()).toBe(100);
    expect(constructed.providerReference).toBe("provider-result");
    expect(constructed.complete("provider-result", requestedAt)).toBe(false);
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
