import { describe, expect, test, vi } from "vitest";
import { LedgerTransaction, Money } from "@/domain";
import { GetWalletSummary } from "@/use-cases/wallet/GetWalletSummary";
import { ListWalletTransactions } from "@/use-cases/wallet/ListWalletTransactions";
import { CreateWalletTopUp } from "@/use-cases/wallet/CreateWalletTopUp";
import type { WalletReader, WalletTopUpProvider } from "@/use-cases/wallet/contracts";

const now = new Date("2026-10-17T03:00:00Z");

function reader() {
  return {
    findWalletIdByUserId: vi.fn<WalletReader["findWalletIdByUserId"]>().mockResolvedValue("wallet-a"),
    getWalletBalance: vi.fn<WalletReader["getWalletBalance"]>().mockResolvedValue({
      walletId: "wallet-a", availableBalance: Money.fromCents(2500),
    }),
    listActiveHolds: vi.fn<WalletReader["listActiveHolds"]>().mockResolvedValue([]),
    listWalletTransactions: vi.fn<WalletReader["listWalletTransactions"]>().mockResolvedValue([]),
  };
}

function provider() {
  return { createIntent: vi.fn<WalletTopUpProvider["createIntent"]>().mockResolvedValue({
    paymentIntentId: "pi_a", clientSecret: "secret", amountCents: 2000,
    currency: "SGD", status: "requires_payment_method",
  }) };
}

describe("UC1-05 wallet workflows", () => {
  test("combines current balance with outstanding holds, preserving original amounts and dates", async () => {
    const reads = reader();
    reads.listActiveHolds.mockResolvedValue([100, 250].map((cents, index) => ({
      holdId: `hold-${index}`, sessionId: `session-${index}`,
      heldAmount: Money.fromCents(cents), originalAmount: Money.fromCents(500), createdAt: now,
    })));

    const result = await new GetWalletSummary(reads).forUser("user-a");

    expect(result).toMatchObject({ walletId: "wallet-a", userId: "user-a",
      availableBalanceCents: 2500, heldBalanceCents: 350, currency: "SGD" });
    expect(result.activeHolds[0]).toMatchObject({ heldCents: 100, originalCents: 500, createdAt: now });
    expect(reads.findWalletIdByUserId).toHaveBeenCalledWith("user-a");
    expect(reads.getWalletBalance).toHaveBeenCalledWith("wallet-a");
    expect(reads.listActiveHolds).toHaveBeenCalledWith("wallet-a");
  });

  test("keeps an empty wallet at zero before its first ledger entry", async () => {
    const reads = reader();
    reads.getWalletBalance.mockResolvedValue(null);
    expect(await new GetWalletSummary(reads).forUser("user-a")).toMatchObject({
      availableBalanceCents: 0, heldBalanceCents: 0, activeHolds: [],
    });
  });

  test.each(["summary", "history", "top-up"])("rejects a missing wallet before %s work", async (workflow) => {
    const reads = reader();
    const payments = provider();
    reads.findWalletIdByUserId.mockResolvedValue(null);
    const run = workflow === "summary" ? new GetWalletSummary(reads).forUser("missing")
      : workflow === "history" ? new ListWalletTransactions(reads).forUser("missing", {})
      : new CreateWalletTopUp(reads, payments).forUser("missing", { amountCents: 2000, idempotencyKey: "retry" });
    await expect(run).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(reads.getWalletBalance).not.toHaveBeenCalled();
    expect(reads.listActiveHolds).not.toHaveBeenCalled();
    expect(reads.listWalletTransactions).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  test("returns history continuation from the final entry and forwards the owner's cursor", async () => {
    const reads = reader();
    reads.listWalletTransactions.mockResolvedValue([new LedgerTransaction({
      transactionId: "entry-a", walletId: "wallet-a", kind: "TOP_UP", amount: Money.fromCents(2000),
      occurredAt: now, idempotencyKey: "credit-a",
    })]);
    const before = new Date("2026-10-18T00:00:00Z");

    const result = await new ListWalletTransactions(reads).forUser("user-a", { limit: 1, before });

    expect(reads.listWalletTransactions).toHaveBeenCalledWith({ walletId: "wallet-a", limit: 1, occurredBefore: before });
    expect(result).toEqual({ items: [{ transactionId: "entry-a", kind: "TOP_UP", amountCents: 2000,
      occurredAt: now, idempotencyKey: "credit-a", externalReference: null, holdId: null, payoutId: null }],
    nextCursor: now });
  });

  test.each([[undefined, 50], [0, 1], [999, 200]])("bounds a history limit of %s to %s", async (limit, expected) => {
    const reads = reader();
    const result = await new ListWalletTransactions(reads).forUser("user-a", { limit });
    expect(reads.listWalletTransactions).toHaveBeenCalledWith({ walletId: "wallet-a", limit: expected, occurredBefore: undefined });
    expect(result.nextCursor).toBeNull();
  });

  test("binds top-up to the stored wallet and preserves the retry key without crediting it", async () => {
    const reads = reader();
    const payments = provider();
    const result = await new CreateWalletTopUp(reads, payments).forUser("user-a", { amountCents: 2000, idempotencyKey: "retry-a" });
    expect(payments.createIntent).toHaveBeenCalledExactlyOnceWith({
      userId: "user-a", walletId: "wallet-a", amountCents: 2000, idempotencyKey: "retry-a",
    });
    expect(result.paymentIntentId).toBe("pi_a");
  });

  test("preserves infrastructure failures instead of treating them as a missing wallet", async () => {
    const reads = reader();
    const payments = provider();
    const failure = new Error("database unavailable");
    reads.findWalletIdByUserId.mockRejectedValue(failure);
    await expect(new CreateWalletTopUp(reads, payments).forUser("user-a", {
      amountCents: 2000, idempotencyKey: "retry-a",
    })).rejects.toBe(failure);
    expect(payments.createIntent).not.toHaveBeenCalled();
  });
});
