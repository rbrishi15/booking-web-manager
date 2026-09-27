import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("fromCents_WhenZero_PreservesExactCents", () => {
    // Arrange
    const cents = 0;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenPositiveCent_PreservesExactCents", () => {
    // Arrange
    const cents = 1;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenNegativeCent_PreservesExactCents", () => {
    // Arrange
    const cents = -1;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenWholeCents_PreservesExactCents", () => {
    // Arrange
    const cents = 1001;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenMaximumSafeInteger_PreservesExactCents", () => {
    // Arrange
    const cents = Number.MAX_SAFE_INTEGER;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenMinimumSafeInteger_PreservesExactCents", () => {
    // Arrange
    const cents = Number.MIN_SAFE_INTEGER;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(cents);
  });

  test("fromCents_WhenNegativeZero_NormalizesToZero", () => {
    // Arrange
    const cents = -0;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(0);
  });

  test("fromCents_WhenPositiveFraction_ThrowsRangeError", () => {
    // Arrange
    const cents = 0.1;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenNegativeFraction_ThrowsRangeError", () => {
    // Arrange
    const cents = -0.1;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenNaN_ThrowsRangeError", () => {
    // Arrange
    const cents = Number.NaN;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenPositiveInfinity_ThrowsRangeError", () => {
    // Arrange
    const cents = Number.POSITIVE_INFINITY;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenNegativeInfinity_ThrowsRangeError", () => {
    // Arrange
    const cents = Number.NEGATIVE_INFINITY;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenAboveMaximum_ThrowsRangeError", () => {
    // Arrange
    const cents = Number.MAX_SAFE_INTEGER + 1;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("fromCents_WhenBelowMinimum_ThrowsRangeError", () => {
    // Arrange
    const cents = Number.MIN_SAFE_INTEGER - 1;

    // Act & Assert
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });
});
