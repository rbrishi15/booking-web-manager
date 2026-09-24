import {
  DomainError,
  HoldingAccount,
  LedgerTransaction,
  type LedgerTransactionDetails,
  Money,
  Wallet,
} from "@/domain";
import { describe, expect, it } from "vitest";

describe("Financial identity constructors", () => {
  it("validates identities and owns its values independently of caller input", () => {
    const input = { walletId: "wallet", userId: "owner", transactions: [] };
    const wallet = new Wallet(input);
    input.walletId = "changed";
    input.userId = "changed";
    expect(wallet.walletId).toBe("wallet");
    expect(wallet.userId).toBe("owner");
    expect(Reflect.set(wallet, "walletId", "changed")).toBe(false);
    expect(new HoldingAccount({ accountId: "platform" }).accountId).toBe(
      "platform",
    );
    expect(
      () => new Wallet({ walletId: " ", userId: "owner", transactions: [] }),
    ).toThrow(DomainError);
    expect(
      () => new Wallet({ walletId: "wallet", userId: " ", transactions: [] }),
    ).toThrow(DomainError);
    expect(() => new HoldingAccount({ accountId: " " })).toThrow(DomainError);
  });
});

function transactionDetails(
  overrides: Partial<LedgerTransactionDetails> = {},
): LedgerTransactionDetails {
  return {
    transactionId: "transaction",
    amount: Money.fromCents(500),
    kind: "TOP_UP",
    occurredAt: new Date("2026-10-01"),
    idempotencyKey: "key",
    walletId: "wallet",
    ...overrides,
  };
}

describe("LedgerTransaction constructor", () => {
  it("constructs a financial fact and isolates incoming and outgoing dates", () => {
    const input = transactionDetails();
    const entry = new LedgerTransaction(input);
    input.occurredAt.setTime(0);
    entry.occurredAt.setTime(0);
    expect(entry.transactionId).toBe("transaction");
    expect(entry.walletId).toBe("wallet");
    expect(entry.kind).toBe("TOP_UP");
    expect(entry.idempotencyKey).toBe("key");
    expect(entry.amount.toCents()).toBe(500);
    expect(entry.occurredAt).toEqual(new Date("2026-10-01"));
  });

  it("rejects invalid amounts, identifiers, references, kinds, and dates", () => {
    const invalid: Partial<LedgerTransactionDetails>[] = [
      { amount: Money.fromCents(0) },
      { amount: Money.fromCents(-1) },
      { transactionId: " " },
      { idempotencyKey: " " },
      { walletId: " " },
      { holdId: " " },
      { payoutId: " " },
      { externalReference: " " },
      { kind: "UNKNOWN" as LedgerTransactionDetails["kind"] },
    ];
    for (const change of invalid)
      expect(() => new LedgerTransaction(transactionDetails(change))).toThrow(
        DomainError,
      );
    expect(
      () =>
        new LedgerTransaction(
          transactionDetails({ occurredAt: new Date(NaN) }),
        ),
    ).toThrow(RangeError);
  });
});
