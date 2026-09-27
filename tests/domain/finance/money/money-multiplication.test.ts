import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("multiply_WhenFactorIsPositive_ReturnsProductAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const product = money.multiply(3);

    // Assert
    expect(product.toCents()).toBe(1500);
    expect(money.toCents()).toBe(500);
  });

  test("multiply_WhenFactorIsNegative_ReturnsProductAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const product = money.multiply(-3);

    // Assert
    expect(product.toCents()).toBe(-1500);
    expect(money.toCents()).toBe(500);
  });

  test("multiply_WhenFactorIsZero_ReturnsProductAndPreservesSource", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const product = money.multiply(0);

    // Assert
    expect(product.toCents()).toBe(0);
    expect(money.toCents()).toBe(500);
  });

  test("multiply_WhenFactorIsOne_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const product = money.multiply(1);

    // Assert
    expect(product).not.toBe(money);
  });

  test("multiply_WhenFactorIsFractional_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(0.5)).toThrow(RangeError);
  });

  test("multiply_WhenFactorIsNaN_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(Number.NaN)).toThrow(RangeError);
  });

  test("multiply_WhenFactorIsPositiveInfinity_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test("multiply_WhenFactorIsNegativeInfinity_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  test("multiply_WhenFactorIsAboveMaximum_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });

  test("multiply_WhenFactorIsBelowMinimum_RejectsEvenForZeroCents", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act & Assert
    expect(() => money.multiply(Number.MIN_SAFE_INTEGER - 1)).toThrow(
      RangeError,
    );
  });
});
