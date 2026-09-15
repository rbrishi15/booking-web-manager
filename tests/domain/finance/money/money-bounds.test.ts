import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money safe-integer bounds", () => {
  describe("preserves exact arithmetic within safe-integer bounds", () => {
    test("adds the maximum and minimum values to zero", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
      const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

      // Act
      const sum = maximum.add(minimum);

      // Assert
      expect(sum.toCents()).toBe(0);
    });

    test("subtracts one from the maximum value", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const difference = maximum.subtract(Money.fromCents(1));

      // Assert
      expect(difference.toCents()).toBe(Number.MAX_SAFE_INTEGER - 1);
    });

    test("negates the minimum value to the maximum value", () => {
      // Arrange
      const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const negatedMinimum = minimum.multiply(-1);

      // Assert
      expect(negatedMinimum.equals(maximum)).toBe(true);
    });

    test("scales one cent to the maximum value", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const scaledUnit = Money.fromCents(1).multiply(Number.MAX_SAFE_INTEGER);

      // Assert
      expect(scaledUnit.equals(maximum)).toBe(true);
    });
  });

  describe("rejects overflow in arithmetic operations", () => {
    test("rejects addition overflow", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const add = () => maximum.add(Money.fromCents(1));

      // Assert
      expect(add).toThrow(RangeError);
    });

    test("rejects addition underflow", () => {
      // Arrange
      const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

      // Act
      const add = () => minimum.add(Money.fromCents(-1));

      // Assert
      expect(add).toThrow(RangeError);
    });

    test("rejects subtraction overflow", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const subtract = () => maximum.subtract(Money.fromCents(-1));

      // Assert
      expect(subtract).toThrow(RangeError);
    });

    test("rejects subtraction underflow", () => {
      // Arrange
      const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

      // Act
      const subtract = () => minimum.subtract(Money.fromCents(1));

      // Assert
      expect(subtract).toThrow(RangeError);
    });

    test("rejects multiplication overflow for the maximum value", () => {
      // Arrange
      const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);

      // Act
      const multiply = () => maximum.multiply(2);

      // Assert
      expect(multiply).toThrow(RangeError);
    });

    test("rejects multiplication overflow for the minimum value", () => {
      // Arrange
      const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

      // Act
      const multiply = () => minimum.multiply(2);

      // Assert
      expect(multiply).toThrow(RangeError);
    });
  });
});
