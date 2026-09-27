import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("add_WhenMaximumAndMinimumAreCombined_ReturnsZero", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const sum = maximum.add(minimum);

    // Assert
    expect(sum.toCents()).toBe(0);
  });

  test("add_WhenResultExceedsMaximum_ThrowsRangeError", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act & Assert
    expect(() => maximum.add(Money.fromCents(1))).toThrow(RangeError);
  });

  test("add_WhenResultFallsBelowMinimum_ThrowsRangeError", () => {
    // Arrange
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act & Assert
    expect(() => minimum.add(Money.fromCents(-1))).toThrow(RangeError);
  });

  test("subtract_WhenOneIsSubtractedFromMaximum_PreservesExactValue", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const difference = maximum.subtract(Money.fromCents(1));

    // Assert
    expect(difference.toCents()).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test("subtract_WhenResultExceedsMaximum_ThrowsRangeError", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act & Assert
    expect(() => maximum.subtract(Money.fromCents(-1))).toThrow(RangeError);
  });

  test("subtract_WhenResultFallsBelowMinimum_ThrowsRangeError", () => {
    // Arrange
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act & Assert
    expect(() => minimum.subtract(Money.fromCents(1))).toThrow(RangeError);
  });

  test("multiply_WhenMinimumIsNegated_ReturnsMaximum", () => {
    // Arrange
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const negatedMinimum = minimum.multiply(-1);

    // Assert
    expect(negatedMinimum.equals(maximum)).toBe(true);
  });

  test("multiply_WhenOneCentIsScaledToMaximum_PreservesExactValue", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const scaledUnit = Money.fromCents(1).multiply(Number.MAX_SAFE_INTEGER);

    // Assert
    expect(scaledUnit.equals(maximum)).toBe(true);
  });

  test("multiply_WhenMaximumIsDoubled_ThrowsRangeError", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act & Assert
    expect(() => maximum.multiply(2)).toThrow(RangeError);
  });

  test("multiply_WhenMinimumIsDoubled_ThrowsRangeError", () => {
    // Arrange
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act & Assert
    expect(() => minimum.multiply(2)).toThrow(RangeError);
  });
});
