import {
  DomainError,
  LedgerTransaction,
  type LedgerTransactionDetails,
  Money,
  Wallet,
  type WalletDetails,
} from "@/domain";
import { describe, expect, test } from "vitest";

describe("Wallet", () => {
  describe("Construction and identity", () => {
    test("constructor_WhenInputIdentityIsMutated_PreservesWalletIdentity", () => {
      // Arrange
      const input = { walletId: "wallet", userId: "owner", transactions: [] };
      const wallet = new Wallet(input);

      // Act
      input.walletId = "changed";
      input.userId = "changed";
      const identityChanged = Reflect.set(wallet, "walletId", "changed");

      // Assert
      expect(wallet.walletId).toBe("wallet");
      expect(wallet.userId).toBe("owner");
      expect(identityChanged).toBe(false);
    });

    test("constructor_WhenWalletIdIsBlank_ThrowsDomainError", () => {
      // Arrange
      const details = { walletId: " ", userId: "owner", transactions: [] };

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(DomainError);
    });

    test("constructor_WhenUserIdIsBlank_ThrowsDomainError", () => {
      // Arrange
      const details = { walletId: "wallet", userId: " ", transactions: [] };

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(DomainError);
    });

    test("constructor_WhenBalanceWouldBeNegative_ThrowsInvalidInput", () => {
      // Arrange
      const history = [
        entry("credit", "TOP_UP", 500),
        entry("debit", "LOCK", 501),
      ];

      // Act & Assert
      expect(() => wallet(history)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenFundsExceedSafeIntegerRange_ThrowsRangeError", () => {
      // Arrange
      const history = [
        entry("credit", "TOP_UP", Number.MAX_SAFE_INTEGER),
        entry("overflow", "TOP_UP", 1),
      ];

      // Act & Assert
      expect(() => wallet(history)).toThrow(RangeError);
    });

    test("constructor_WhenHistoryIsMissing_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: undefined,
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenHistoryIsNull_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: null,
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenHistoryIsNotAnArray_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: new Set(),
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenEntryBelongsToAnotherWallet_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: [entry("foreign", "TOP_UP", 100, { walletId: "other" })],
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenEntryHasNoWallet_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: [
          entry("unassigned", "TOP_UP", 100, { walletId: undefined }),
        ],
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenTransactionIdsAreDuplicated_ThrowsInvalidInput", () => {
      // Arrange
      const details = {
        walletId: "wallet",
        userId: "owner",
        transactions: [
          entry("same", "TOP_UP", 100),
          entry("same", "REFUND", 100),
        ],
      } as unknown as WalletDetails;

      // Act & Assert
      expect(() => new Wallet(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });
  });

  describe("Available funds", () => {
    test("getFunds_WhenHistoryIsEmpty_ReturnsZero", () => {
      // Arrange
      const emptyWallet = wallet([]);

      // Act
      const funds = emptyWallet.getFunds();

      // Assert
      expect(funds.equals(Money.fromCents(0))).toBe(true);
    });

    test("getFunds_WhenHistoryIncludesTopUp_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "TOP_UP", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(1200);
    });

    test("getFunds_WhenHistoryIncludesRefund_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "REFUND", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(1200);
    });

    test("getFunds_WhenHistoryIncludesLock_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "LOCK", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(800);
    });

    test("getFunds_WhenHistoryIncludesPayout_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "PAYOUT", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(800);
    });

    test("getFunds_WhenHistoryIncludesRelease_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "RELEASE", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(1000);
    });

    test("getFunds_WhenHistoryIncludesForfeit_ReturnsSpendableBalance", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("initial", "TOP_UP", 1_000),
        entry("movement", "FORFEIT", 200),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(1000);
    });

    test("getFunds_WhenHoldsAreRefundedReleasedOrForfeited_AppliesEachMovementOnce", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("top-up", "TOP_UP", 1_000),
        entry("lock-refunded", "LOCK", 200),
        entry("refund", "REFUND", 200),
        entry("lock-released", "LOCK", 300),
        entry("release", "RELEASE", 300),
        entry("lock-forfeited", "LOCK", 100),
        entry("forfeit", "FORFEIT", 100),
        entry("withdrawal", "PAYOUT", 150),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(450);
    });

    test("getFunds_WhenExactAvailableAmountIsSpent_ReturnsZero", () => {
      // Arrange
      const fundedWallet = wallet([
        entry("credit", "TOP_UP", 500),
        entry("debit", "LOCK", 500),
      ]);

      // Act
      const funds = fundedWallet.getFunds();

      // Assert
      expect(funds.toCents()).toBe(0);
    });

    test("getFunds_WhenTransactionOrderChanges_PreservesExactBalance", () => {
      // Arrange
      const history = [
        entry("credit", "TOP_UP", Number.MAX_SAFE_INTEGER),
        entry("extra", "TOP_UP", 1),
        entry("debit", "PAYOUT", Number.MAX_SAFE_INTEGER),
      ];

      // Act
      const forwardFunds = wallet(history).getFunds();
      const reversedFunds = wallet([...history].reverse()).getFunds();

      // Assert
      expect(forwardFunds.toCents()).toBe(1);
      expect(reversedFunds.toCents()).toBe(1);
    });
  });

  describe("Transaction isolation", () => {
    test("transactions_WhenInputsAndOutputsAreMutated_PreservesHistoryAndFunds", () => {
      // Arrange
      const credit = entry("credit", "TOP_UP", 700);
      const history = [credit];
      const fundedWallet = wallet(history);

      // Act
      history.length = 0;
      (fundedWallet.transactions as LedgerTransaction[]).push(
        entry("extra", "TOP_UP", 100),
      );
      const amountChanged = Reflect.set(credit, "amount", Money.fromCents(0));
      credit.occurredAt.setTime(0);

      // Assert
      expect(amountChanged).toBe(false);
      expect(fundedWallet.transactions).toEqual([credit]);
      expect(fundedWallet.transactions[0]?.occurredAt.toISOString()).toBe(
        "2026-10-01T10:00:00.000Z",
      );
      expect(fundedWallet.getFunds().toCents()).toBe(700);
    });
  });
});

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
