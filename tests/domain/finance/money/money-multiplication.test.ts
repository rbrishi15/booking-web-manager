import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money multiplication", () => {
  test.each([
    [3, 1500],
    [-3, -1500],
    [0, 0],
  ])("multiplies by integer %s", (factor, result) => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const multiplied = money.multiply(factor);
    const multipliedByOne = money.multiply(1);

    // Assert
    expect(multiplied.toCents()).toBe(result);
    expect(money.toCents()).toBe(500);
    expect(multipliedByOne).not.toBe(money);
  });

  test.each([
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
  ])(
    "rejects invalid multiplication factor %s even for zero cents",
    (factor) => {
      // Arrange
      const money = Money.fromCents(0);

      // Act
      const multiply = () => money.multiply(factor);

      // Assert
      expect(multiply).toThrow(RangeError);
    },
  );
});
