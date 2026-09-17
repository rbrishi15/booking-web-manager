import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  describe("adds and subtracts signed values without changing either operand", () => {
    describe("add", () => {
      test("adds two money values", () => {
        // Arrange
        const first = Money.fromCents(500);
        const second = Money.fromCents(700);

        // Act
        const sum = first.add(second);

        // Assert
        expect(sum.toCents()).toBe(1200);
      });

      test("can be chained after subtraction", () => {
        // Arrange
        const first = Money.fromCents(500);
        const second = Money.fromCents(700);

        // Act
        const combined = first.subtract(second).add(first);

        // Assert
        expect(combined.toCents()).toBe(300);
      });

      test("returns a new instance when adding zero", () => {
        // Arrange
        const money = Money.fromCents(500);

        // Act
        const result = money.add(Money.fromCents(0));

        // Assert
        expect(result).not.toBe(money);
      });
    });

    describe("subtract", () => {
      test("subtracts two money values", () => {
        // Arrange
        const first = Money.fromCents(500);
        const second = Money.fromCents(700);

        // Act
        const difference = first.subtract(second);

        // Assert
        expect(difference.toCents()).toBe(-200);
      });

      test("supports subtracting a negative value", () => {
        // Arrange
        const money = Money.fromCents(500);

        // Act
        const result = money.subtract(Money.fromCents(-100));

        // Assert
        expect(result.toCents()).toBe(600);
      });

      test("returns a new instance when subtracting zero", () => {
        // Arrange
        const money = Money.fromCents(500);

        // Act
        const result = money.subtract(Money.fromCents(0));

        // Assert
        expect(result).not.toBe(money);
      });
    });

    describe("immutability", () => {
      test("does not change either operand", () => {
        // Arrange
        const first = Money.fromCents(500);
        const second = Money.fromCents(700);

        // Act
        first.add(second);
        first.subtract(second);

        // Assert
        expect(first.toCents()).toBe(500);
        expect(second.toCents()).toBe(700);
      });

      test("freezes money instances", () => {
        // Arrange
        const money = Money.fromCents(500);

        // Assert
        expect(Object.isFrozen(money)).toBe(true);
      });
    });
  });
});
