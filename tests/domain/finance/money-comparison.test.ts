import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  describe("compares values rather than instance identity", () => {
    describe("equals", () => {
      test("returns true for separate instances with the same value", () => {
        // Arrange
        const first = Money.fromCents(500);
        const equal = Money.fromCents(500);

        // Act
        const equalByValue = first.equals(equal);

        // Assert
        expect(first).not.toBe(equal);
        expect(equalByValue).toBe(true);
      });

      test("returns false for different values", () => {
        // Arrange
        const first = Money.fromCents(500);
        const greater = Money.fromCents(501);

        // Act
        const differentByValue = first.equals(greater);

        // Assert
        expect(differentByValue).toBe(false);
      });
    });

    describe("compareTo", () => {
      test("returns zero for equal values", () => {
        // Arrange
        const first = Money.fromCents(500);
        const equal = Money.fromCents(500);

        // Act
        const comparison = first.compareTo(equal);

        // Assert
        expect(comparison).toBe(0);
      });

      test("returns -1 when the first value is smaller", () => {
        // Arrange
        const first = Money.fromCents(500);
        const greater = Money.fromCents(501);

        // Act
        const comparison = first.compareTo(greater);

        // Assert
        expect(comparison).toBe(-1);
      });

      test("returns 1 when the first value is greater", () => {
        // Arrange
        const greater = Money.fromCents(501);
        const first = Money.fromCents(500);

        // Act
        const comparison = greater.compareTo(first);

        // Assert
        expect(comparison).toBe(1);
      });

      test("orders negative values before zero", () => {
        // Arrange
        const negative = Money.fromCents(-1);
        const zero = Money.fromCents(0);

        // Act
        const comparison = negative.compareTo(zero);

        // Assert
        expect(comparison).toBe(-1);
      });
    });
  });
});
