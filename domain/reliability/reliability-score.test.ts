import { describe, expect, test } from "vitest";
import { ReliabilityScore } from "./reliability-score";

describe("ReliabilityScore", () => {
  test.each([0, 100, 48, 66.66666666666667])("preserves score %s", (score) => {
    expect(ReliabilityScore.from(score).toNumber()).toBe(score);
  });

  test("normalizes negative zero", () => {
    expect(ReliabilityScore.from(-0).toNumber()).toBe(0);
  });

  test.each([
    -0.001,
    100.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects score %s outside the finite 0–100 scale", (score) => {
    expect(() => ReliabilityScore.from(score)).toThrow(RangeError);
  });

  test("compares scores by value", () => {
    const first = ReliabilityScore.from(75.5);
    const equal = ReliabilityScore.from(75.5);
    const greater = ReliabilityScore.from(80);

    expect(first).not.toBe(equal);
    expect(first.equals(equal)).toBe(true);
    expect(first.equals(greater)).toBe(false);
    expect(first.compareTo(equal)).toBe(0);
    expect(first.compareTo(greater)).toBe(-1);
    expect(greater.compareTo(first)).toBe(1);
  });

  test("treats the minimum threshold as inclusive", () => {
    const score = ReliabilityScore.from(75.5);

    expect(score.meetsMinimum(ReliabilityScore.from(75))).toBe(true);
    expect(score.meetsMinimum(ReliabilityScore.from(75.5))).toBe(true);
    expect(score.meetsMinimum(ReliabilityScore.from(75.5001))).toBe(false);
    expect(
      ReliabilityScore.from(0).meetsMinimum(ReliabilityScore.from(0)),
    ).toBe(true);
    expect(
      ReliabilityScore.from(100).meetsMinimum(ReliabilityScore.from(100)),
    ).toBe(true);
  });

  test("keeps the score immutable", () => {
    const score = ReliabilityScore.from(66.66666666666667);

    expect(Object.isFrozen(score)).toBe(true);
    expect(score.toNumber()).toBe(66.66666666666667);
  });
});
