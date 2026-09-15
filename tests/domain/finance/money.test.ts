import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
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

  test.each([
    [1001, 3, 333],
    [-1001, 3, -334],
    [1002, 3, 334],
    [-1002, 3, -334],
    [1, 3, 0],
    [-1, 3, -1],
    [0, 3, 0],
    [Number.MAX_SAFE_INTEGER, 2, 4503599627370495],
    [Number.MIN_SAFE_INTEGER, 2, -4503599627370496],
    [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, 0],
  ])("floors %s cents divided by %s to %s", (cents, divisor, result) => {
    // Arrange
    const money = Money.fromCents(cents);

    // Act
    const divided = money.divideFloor(divisor);
    const dividedByOne = money.divideFloor(1);

    // Assert
    expect(divided.toCents()).toBe(result);
    expect(money.toCents()).toBe(cents);
    expect(dividedByOne).not.toBe(money);
  });

  test.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid divisor %s", (divisor) => {
    // Arrange
    const money = Money.fromCents(100);

    // Act
    const divide = () => money.divideFloor(divisor);

    // Assert
    expect(divide).toThrow(RangeError);
  });

  test("preserves exact arithmetic within safe-integer bounds", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const sum = maximum.add(minimum);
    const difference = maximum.subtract(Money.fromCents(1));
    const negatedMinimum = minimum.multiply(-1);
    const scaledUnit = Money.fromCents(1).multiply(Number.MAX_SAFE_INTEGER);

    // Assert
    expect(sum.toCents()).toBe(0);
    expect(difference.toCents()).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(negatedMinimum.equals(maximum)).toBe(true);
    expect(scaledUnit.equals(maximum)).toBe(true);
  });

  test("rejects overflow in every arithmetic operation that can overflow", () => {
    // Arrange
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const overflowingAdd = () => maximum.add(Money.fromCents(1));
    const underflowingAdd = () => minimum.add(Money.fromCents(-1));
    const overflowingSubtract = () => maximum.subtract(Money.fromCents(-1));
    const underflowingSubtract = () => minimum.subtract(Money.fromCents(1));
    const overflowingMaximumMultiply = () => maximum.multiply(2);
    const overflowingMinimumMultiply = () => minimum.multiply(2);

    // Assert
    expect(overflowingAdd).toThrow(RangeError);
    expect(underflowingAdd).toThrow(RangeError);
    expect(overflowingSubtract).toThrow(RangeError);
    expect(underflowingSubtract).toThrow(RangeError);
    expect(overflowingMaximumMultiply).toThrow(RangeError);
    expect(overflowingMinimumMultiply).toThrow(RangeError);
  });
});
