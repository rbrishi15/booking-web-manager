import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money construction", () => {
  test.each([0, 1, -1, 1001, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    "represents %s integer SGD cents",
    (cents) => {
      // Arrange
      const expectedCents = cents;

      // Act
      const money = Money.fromCents(expectedCents);

      // Assert
      expect(money.toCents()).toBe(expectedCents);
    },
  );

  test("normalizes negative zero", () => {
    // Arrange
    const cents = -0;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(money.toCents()).toBe(0);
  });

  test.each([
    0.1,
    -0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
  ])("rejects invalid cents %s", (cents) => {
    // Arrange
    const invalidCents = cents;

    // Act
    const create = () => Money.fromCents(invalidCents);

    // Assert
    expect(create).toThrow(RangeError);
  });
});
