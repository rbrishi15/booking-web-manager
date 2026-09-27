import { DomainError, FundHold, type FundHoldDetails, Money } from "@/domain";
import { describe, expect, test } from "vitest";

const createdAt = new Date("2026-10-01");
const settledAt = new Date("2026-10-03");

describe("FundHold", () => {
  describe("Construction and lifecycle metadata", () => {
    test("constructor_WhenStateIsHeld_PreservesAmountAndIsolatesDate", () => {
      // Arrange
      const input = holdDetails({ state: "HELD" });
      const hold = new FundHold(input);

      // Act
      input.createdAt.setTime(0);
      hold.createdAt.setTime(0);

      // Assert
      expect(hold.state).toBe("HELD");
      expect(hold.amount.toCents()).toBe(500);
      expect(hold.createdAt).toEqual(createdAt);
    });

    test("constructor_WhenStateIsAwaitingReplacement_PreservesAmountAndIsolatesDate", () => {
      // Arrange
      const input = holdDetails({ state: "AWAITING_REPLACEMENT" });
      const hold = new FundHold(input);

      // Act
      input.createdAt.setTime(0);
      hold.createdAt.setTime(0);

      // Assert
      expect(hold.state).toBe("AWAITING_REPLACEMENT");
      expect(hold.amount.toCents()).toBe(500);
      expect(hold.createdAt).toEqual(createdAt);
    });

    test("constructor_WhenStateIsForfeitureDue_PreservesAmountAndIsolatesDate", () => {
      // Arrange
      const input = holdDetails({ state: "FORFEITURE_DUE" });
      const hold = new FundHold(input);

      // Act
      input.createdAt.setTime(0);
      hold.createdAt.setTime(0);

      // Assert
      expect(hold.state).toBe("FORFEITURE_DUE");
      expect(hold.amount.toCents()).toBe(500);
      expect(hold.createdAt).toEqual(createdAt);
    });

    test("constructor_WhenStateIsRefunded_PreservesTerminalMetadata", () => {
      // Arrange
      const date = new Date(settledAt);
      const hold = new FundHold(
        holdDetails({
          state: "REFUNDED",
          settledAt: date,
          payoutId: undefined,
        }),
      );

      // Act
      date.setTime(0);
      hold.settledAt?.setTime(0);

      // Assert
      expect(hold.state).toBe("REFUNDED");
      expect(hold.settledAt).toEqual(settledAt);
      expect(hold.payoutId).toBe(undefined);
    });

    test("constructor_WhenStateIsReleased_PreservesTerminalMetadata", () => {
      // Arrange
      const date = new Date(settledAt);
      const hold = new FundHold(
        holdDetails({ state: "RELEASED", settledAt: date, payoutId: "payout" }),
      );

      // Act
      date.setTime(0);
      hold.settledAt?.setTime(0);

      // Assert
      expect(hold.state).toBe("RELEASED");
      expect(hold.settledAt).toEqual(settledAt);
      expect(hold.payoutId).toBe("payout");
    });

    test("constructor_WhenStateIsForfeited_PreservesTerminalMetadata", () => {
      // Arrange
      const date = new Date(settledAt);
      const hold = new FundHold(
        holdDetails({
          state: "FORFEITED",
          settledAt: date,
          payoutId: "payout",
        }),
      );

      // Act
      date.setTime(0);
      hold.settledAt?.setTime(0);

      // Assert
      expect(hold.state).toBe("FORFEITED");
      expect(hold.settledAt).toEqual(settledAt);
      expect(hold.payoutId).toBe("payout");
    });

    test("constructor_WhenReleasedMetadataIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({ state: "RELEASED" });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenReleasedPayoutIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({ state: "RELEASED", settledAt });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenForfeitedPayoutIsBlank_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({
        state: "FORFEITED",
        settledAt,
        payoutId: " ",
      });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenRefundHasPayout_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({
        state: "REFUNDED",
        settledAt,
        payoutId: "payout",
      });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenActiveHoldHasSettlementDate_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({ settledAt });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenActiveHoldHasPayout_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({ payoutId: "payout" });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenAmountIsZero_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({ amount: Money.fromCents(0) });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenStateIsUnknown_ThrowsDomainError", () => {
      // Arrange
      const details = holdDetails({
        state: "UNKNOWN" as FundHoldDetails["state"],
      });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(DomainError);
    });

    test("constructor_WhenCreationDateIsInvalid_ThrowsRangeError", () => {
      // Arrange
      const details = holdDetails({ createdAt: new Date(NaN) });

      // Act & Assert
      expect(() => new FundHold(details)).toThrow(RangeError);
    });
  });

  describe("Refunds", () => {
    test("refund_WhenStateIsRefunded_ThrowsDomainError", () => {
      // Arrange
      const hold = new FundHold(
        holdDetails({ state: "REFUNDED", settledAt, payoutId: undefined }),
      );

      // Act & Assert
      expect(() => hold.refund(settledAt)).toThrow(DomainError);
    });

    test("refund_WhenStateIsReleased_ThrowsDomainError", () => {
      // Arrange
      const hold = new FundHold(
        holdDetails({ state: "RELEASED", settledAt, payoutId: "payout" }),
      );

      // Act & Assert
      expect(() => hold.refund(settledAt)).toThrow(DomainError);
    });

    test("refund_WhenStateIsForfeited_ThrowsDomainError", () => {
      // Arrange
      const hold = new FundHold(
        holdDetails({ state: "FORFEITED", settledAt, payoutId: "payout" }),
      );

      // Act & Assert
      expect(() => hold.refund(settledAt)).toThrow(DomainError);
    });
  });
});

function holdDetails(
  overrides: Partial<FundHoldDetails> = {},
): FundHoldDetails {
  return {
    holdId: "hold",
    participationId: "participation",
    holdingAccountId: "platform",
    walletId: "wallet",
    amount: Money.fromCents(500),
    state: "HELD",
    createdAt: new Date(createdAt),
    ...overrides,
  };
}
