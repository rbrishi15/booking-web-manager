import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("equals_WhenSeparateInstancesHaveEqualValues_ReturnsTrue", () => {
    // Arrange
    const first = Money.fromCents(500);
    const equal = Money.fromCents(500);

    // Act
    const equalByValue = first.equals(equal);

    // Assert
    expect(first).not.toBe(equal);
    expect(equalByValue).toBe(true);
  });

  test("equals_WhenValuesDiffer_ReturnsFalse", () => {
    // Arrange
    const first = Money.fromCents(500);
    const greater = Money.fromCents(501);

    // Act
    const differentByValue = first.equals(greater);

    // Assert
    expect(differentByValue).toBe(false);
  });

  test("compareTo_WhenValuesAreEqual_ReturnsZero", () => {
    // Arrange
    const first = Money.fromCents(500);
    const equal = Money.fromCents(500);

    // Act
    const comparison = first.compareTo(equal);

    // Assert
    expect(comparison).toBe(0);
  });

  test("compareTo_WhenValueIsSmaller_ReturnsNegativeOne", () => {
    // Arrange
    const first = Money.fromCents(500);
    const greater = Money.fromCents(501);

    // Act
    const comparison = first.compareTo(greater);

    // Assert
    expect(comparison).toBe(-1);
  });

  test("compareTo_WhenValueIsGreater_ReturnsOne", () => {
    // Arrange
    const greater = Money.fromCents(501);
    const first = Money.fromCents(500);

    // Act
    const comparison = greater.compareTo(first);

    // Assert
    expect(comparison).toBe(1);
  });

  test("compareTo_WhenComparingNegativeToZero_ReturnsNegativeOne", () => {
    // Arrange
    const negative = Money.fromCents(-1);
    const zero = Money.fromCents(0);

    // Act
    const comparison = negative.compareTo(zero);

    // Assert
    expect(comparison).toBe(-1);
  });
});
