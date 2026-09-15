import { describe, expect, test } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  test.each([0, 1, -1, 1001, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    "represents %s integer SGD cents",
    (cents) => {
      expect(Money.fromCents(cents).toCents()).toBe(cents);
    },
  );

  test("normalizes negative zero", () => {
    expect(Money.fromCents(-0).toCents()).toBe(0);
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
    expect(() => Money.fromCents(cents)).toThrow(RangeError);
  });

  test("compares values rather than instance identity", () => {
    const first = Money.fromCents(500);
    const equal = Money.fromCents(500);
    const greater = Money.fromCents(501);

    expect(first).not.toBe(equal);
    expect(first.equals(equal)).toBe(true);
    expect(first.equals(greater)).toBe(false);
    expect(first.compareTo(equal)).toBe(0);
    expect(first.compareTo(greater)).toBe(-1);
    expect(greater.compareTo(first)).toBe(1);
    expect(Money.fromCents(-1).compareTo(Money.fromCents(0))).toBe(-1);
  });

  test("adds and subtracts signed values without changing either operand", () => {
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);
    const sum = first.add(second);
    const difference = first.subtract(second);

    expect(sum.toCents()).toBe(1200);
    expect(difference.toCents()).toBe(-200);
    expect(difference.add(first).toCents()).toBe(300);
    expect(first.subtract(Money.fromCents(-100)).toCents()).toBe(600);
    expect(first.toCents()).toBe(500);
    expect(second.toCents()).toBe(700);
    expect(first.add(Money.fromCents(0))).not.toBe(first);
    expect(first.subtract(Money.fromCents(0))).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  test.each([
    [3, 1500],
    [-3, -1500],
    [0, 0],
  ])("multiplies by integer %s", (factor, result) => {
    const money = Money.fromCents(500);

    expect(money.multiply(factor).toCents()).toBe(result);
    expect(money.toCents()).toBe(500);
    expect(money.multiply(1)).not.toBe(money);
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
      expect(() => Money.fromCents(0).multiply(factor)).toThrow(RangeError);
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
    const money = Money.fromCents(cents);

    expect(money.divideFloor(divisor).toCents()).toBe(result);
    expect(money.toCents()).toBe(cents);
    expect(money.divideFloor(1)).not.toBe(money);
  });

  test.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid divisor %s", (divisor) => {
    expect(() => Money.fromCents(100).divideFloor(divisor)).toThrow(RangeError);
  });

  test("preserves exact arithmetic within safe-integer bounds", () => {
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    expect(maximum.add(minimum).toCents()).toBe(0);
    expect(maximum.subtract(Money.fromCents(1)).toCents()).toBe(
      Number.MAX_SAFE_INTEGER - 1,
    );
    expect(minimum.multiply(-1).equals(maximum)).toBe(true);
    expect(
      Money.fromCents(1).multiply(Number.MAX_SAFE_INTEGER).equals(maximum),
    ).toBe(true);
  });

  test("rejects overflow in every arithmetic operation that can overflow", () => {
    const maximum = Money.fromCents(Number.MAX_SAFE_INTEGER);
    const minimum = Money.fromCents(Number.MIN_SAFE_INTEGER);

    expect(() => maximum.add(Money.fromCents(1))).toThrow(RangeError);
    expect(() => minimum.add(Money.fromCents(-1))).toThrow(RangeError);
    expect(() => maximum.subtract(Money.fromCents(-1))).toThrow(RangeError);
    expect(() => minimum.subtract(Money.fromCents(1))).toThrow(RangeError);
    expect(() => maximum.multiply(2)).toThrow(RangeError);
    expect(() => minimum.multiply(2)).toThrow(RangeError);
  });
});
