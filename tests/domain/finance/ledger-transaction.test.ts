import {
  DomainError,
  LedgerTransaction,
  type LedgerTransactionDetails,
  Money,
} from "@/domain";
import { describe, expect, test } from "vitest";

describe("LedgerTransaction", () => {
  test("constructor_WhenDatesAreMutated_PreservesFinancialFact", () => {
    // Arrange
    const input = transactionDetails();
    const transaction = new LedgerTransaction(input);

    // Act
    input.occurredAt.setTime(0);
    transaction.occurredAt.setTime(0);

    // Assert
    expect(transaction.transactionId).toBe("transaction");
    expect(transaction.walletId).toBe("wallet");
    expect(transaction.kind).toBe("TOP_UP");
    expect(transaction.idempotencyKey).toBe("key");
    expect(transaction.amount.toCents()).toBe(500);
    expect(transaction.occurredAt).toEqual(new Date("2026-10-01"));
  });

  test("constructor_WhenAmountIsZero_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ amount: Money.fromCents(0) });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenAmountIsNegative_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ amount: Money.fromCents(-1) });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenTransactionIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ transactionId: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenIdempotencyKeyIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ idempotencyKey: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenWalletIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ walletId: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenHoldIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ holdId: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenPayoutIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ payoutId: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenExternalReferenceIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({ externalReference: " " });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenKindIsUnknown_ThrowsDomainError", () => {
    // Arrange
    const details = transactionDetails({
      kind: "UNKNOWN" as LedgerTransactionDetails["kind"],
    });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(DomainError);
  });

  test("constructor_WhenDateIsInvalid_ThrowsRangeError", () => {
    // Arrange
    const details = transactionDetails({ occurredAt: new Date(NaN) });

    // Act & Assert
    expect(() => new LedgerTransaction(details)).toThrow(RangeError);
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
