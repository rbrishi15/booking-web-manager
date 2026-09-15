import { describe, expect, it } from "vitest";
import type { SettlementBatch } from "../shared/operations";
import { Money } from "./money";
import { Payout } from "./payout";

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
    const source = batch();
    const payout = Payout.create(source);
    source.requestedAt.setTime(0);
    expect(payout.amount.toCents()).toBe(100);
    expect(payout.complete("provider-result", requestedAt)).toBe(true);
    expect(payout.complete("provider-result", requestedAt)).toBe(false);
    expect(() => payout.complete("other-result", requestedAt)).toThrow();
    expect(Payout.reconstitute(payout.snapshot()).status).toBe("COMPLETED");
  });

  it("keeps failed attempts terminal and records a durable request intent", () => {
    const payout = Payout.create(batch());
    expect(payout.requestedIntent()).toMatchObject({
      kind: "PAYOUT_REQUESTED",
      payoutId: "payout",
      amount: Money.fromCents(100),
    });
    expect(payout.fail("timeout", requestedAt)).toBe(true);
    expect(payout.fail("timeout", requestedAt)).toBe(false);
    expect(() => payout.complete("late", requestedAt)).toThrow();
  });
});
