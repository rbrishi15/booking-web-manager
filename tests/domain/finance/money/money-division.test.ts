import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("divideFloor_WhenPositiveRemainder_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(1001);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(333);
    expect(money.toCents()).toBe(1001);
  });

  test("divideFloor_WhenPositiveRemainderIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(1001);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenNegativeRemainder_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(-1001);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(-334);
    expect(money.toCents()).toBe(-1001);
  });

  test("divideFloor_WhenNegativeRemainderIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(-1001);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenPositiveExactDivision_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(1002);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(334);
    expect(money.toCents()).toBe(1002);
  });

  test("divideFloor_WhenPositiveExactDivisionIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(1002);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenNegativeExactDivision_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(-1002);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(-334);
    expect(money.toCents()).toBe(-1002);
  });

  test("divideFloor_WhenNegativeExactDivisionIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(-1002);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenPositiveCent_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(1);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(0);
    expect(money.toCents()).toBe(1);
  });

  test("divideFloor_WhenPositiveCentIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(1);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenNegativeCent_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(-1);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(-1);
    expect(money.toCents()).toBe(-1);
  });

  test("divideFloor_WhenNegativeCentIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(-1);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenZero_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act
    const quotient = money.divideFloor(3);

    // Assert
    expect(quotient.toCents()).toBe(0);
    expect(money.toCents()).toBe(0);
  });

  test("divideFloor_WhenZeroIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenMaximumSafeInteger_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const quotient = money.divideFloor(2);

    // Assert
    expect(quotient.toCents()).toBe(4503599627370495);
    expect(money.toCents()).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("divideFloor_WhenMaximumSafeIntegerIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenMinimumSafeInteger_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const quotient = money.divideFloor(2);

    // Assert
    expect(quotient.toCents()).toBe(-4503599627370496);
    expect(money.toCents()).toBe(Number.MIN_SAFE_INTEGER);
  });

  test("divideFloor_WhenMinimumSafeIntegerIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenJustBelowMaximumDivisor_RoundsDownAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER - 1);

    // Act
    const quotient = money.divideFloor(Number.MAX_SAFE_INTEGER);

    // Assert
    expect(quotient.toCents()).toBe(0);
    expect(money.toCents()).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test("divideFloor_WhenJustBelowMaximumDivisorIsDividedByOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER - 1);

    // Act
    const quotient = money.divideFloor(1);

    // Assert
    expect(quotient).not.toBe(money);
  });

  test("divideFloor_WhenDivisorIsZero_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(0)).toThrow(RangeError);
  });

  test("divideFloor_WhenDivisorIsNegative_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(-1)).toThrow(RangeError);
  });

  test("divideFloor_WhenDivisorIsFractional_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(0.5)).toThrow(RangeError);
  });

  test("divideFloor_WhenDivisorIsNaN_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(Number.NaN)).toThrow(RangeError);
  });

  test("divideFloor_WhenDivisorIsInfinite_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  test("divideFloor_WhenDivisorIsUnsafeInteger_ThrowsRangeError", () => {
    // Arrange
    const money = Money.fromCents(100);

    // Act & Assert
    expect(() => money.divideFloor(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});
