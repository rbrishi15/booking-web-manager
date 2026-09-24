import {
  LedgerTransaction,
  type LedgerTransactionDetails,
  Money,
  Wallet,
  type WalletDetails,
} from "@/domain";
import { describe, expect, it } from "vitest";

function entry(
  transactionId: string,
  kind: LedgerTransactionDetails["kind"],
  cents: number,
  overrides: Partial<LedgerTransactionDetails> = {},
): LedgerTransaction {
  return new LedgerTransaction({
    transactionId,
    walletId: "wallet",
    kind,
    amount: Money.fromCents(cents),
    occurredAt: new Date("2026-10-01T10:00:00Z"),
    idempotencyKey: transactionId,
    ...overrides,
  });
}

function wallet(transactions: readonly LedgerTransaction[]): Wallet {
  return new Wallet({ walletId: "wallet", userId: "owner", transactions });
}

describe("Wallet funds", () => {
  it("derives zero funds from empty history", () => {
    expect(wallet([]).getFunds().equals(Money.fromCents(0))).toBe(true);
  });

  it.each([
    ["TOP_UP", 1_200],
    ["REFUND", 1_200],
    ["LOCK", 800],
    ["PAYOUT", 800],
    ["RELEASE", 1_000],
    ["FORFEIT", 1_000],
  ] as const)("applies %s to spendable funds", (kind, expected) => {
    const subject = wallet([
      entry("initial", "TOP_UP", 1_000),
      entry("movement", kind, 200),
    ]);
    expect(subject.getFunds().toCents()).toBe(expected);
  });

  it("does not debit held funds again when they are released or forfeited", () => {
    const subject = wallet([
      entry("top-up", "TOP_UP", 1_000),
      entry("lock-refunded", "LOCK", 200),
      entry("refund", "REFUND", 200),
      entry("lock-released", "LOCK", 300),
      entry("release", "RELEASE", 300),
      entry("lock-forfeited", "LOCK", 100),
      entry("forfeit", "FORFEIT", 100),
      entry("withdrawal", "PAYOUT", 150),
    ]);
    expect(subject.getFunds().toCents()).toBe(450);
  });

  it("accepts zero funds after spending the exact available amount", () => {
    expect(
      wallet([entry("credit", "TOP_UP", 500), entry("debit", "LOCK", 500)])
        .getFunds()
        .toCents(),
    ).toBe(0);
  });

  it("rejects a negative resulting balance", () => {
    expect(() =>
      wallet([entry("credit", "TOP_UP", 500), entry("debit", "LOCK", 501)]),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("calculates exact funds independently of transaction order", () => {
    const history = [
      entry("credit", "TOP_UP", Number.MAX_SAFE_INTEGER),
      entry("extra", "TOP_UP", 1),
      entry("debit", "PAYOUT", Number.MAX_SAFE_INTEGER),
    ];
    expect(wallet(history).getFunds().toCents()).toBe(1);
    expect(
      wallet([...history].reverse())
        .getFunds()
        .toCents(),
    ).toBe(1);
  });

  it("rejects funds outside the safe integer range", () => {
    expect(() =>
      wallet([
        entry("credit", "TOP_UP", Number.MAX_SAFE_INTEGER),
        entry("overflow", "TOP_UP", 1),
      ]),
    ).toThrow(RangeError);
  });

  it.each([
    ["missing history", undefined],
    ["null history", null],
    ["non-array history", new Set()],
    [
      "plain entry",
      [{ walletId: "wallet", kind: "TOP_UP", amount: Money.fromCents(100) }],
    ],
    ["null entry", [null]],
    ["sparse history", new Array(1)],
    ["foreign entry", [entry("foreign", "TOP_UP", 100, { walletId: "other" })]],
    [
      "unassigned entry",
      [entry("unassigned", "TOP_UP", 100, { walletId: undefined })],
    ],
    [
      "duplicate IDs",
      [entry("same", "TOP_UP", 100), entry("same", "REFUND", 100)],
    ],
  ])("rejects %s", (_name, transactions) => {
    expect(
      () =>
        new Wallet({
          walletId: "wallet",
          userId: "owner",
          transactions,
        } as unknown as WalletDetails),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("isolates transaction collections and preserves immutable entry values", () => {
    const credit = entry("credit", "TOP_UP", 700);
    const history = [credit];
    const subject = wallet(history);
    history.length = 0;
    (subject.transactions as LedgerTransaction[]).push(
      entry("extra", "TOP_UP", 100),
    );
    expect(Reflect.set(credit, "amount", Money.fromCents(0))).toBe(false);
    credit.occurredAt.setTime(0);

    expect(subject.transactions).toEqual([credit]);
    expect(subject.transactions[0]?.occurredAt.toISOString()).toBe(
      "2026-10-01T10:00:00.000Z",
    );
    expect(subject.getFunds().toCents()).toBe(700);
  });
});
