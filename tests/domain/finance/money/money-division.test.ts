import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money division", () => {
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
});
