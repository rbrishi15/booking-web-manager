import { ReliabilityScore } from "@/domain";
import { describe, expect, test } from "vitest";

describe("ReliabilityScore", () => {
  test.each([0, 100, 48, 66.66666666666667])("preserves score %s", (score) => {
    // Arrange
    const expectedScore = score;

    // Act
    const reliability = ReliabilityScore.from(expectedScore);

    // Assert
    expect(reliability.toNumber()).toBe(expectedScore);
  });

  test("normalizes negative zero", () => {
    // Arrange
    const score = -0;

    // Act
    const reliability = ReliabilityScore.from(score);

    // Assert
    expect(reliability.toNumber()).toBe(0);
  });

  test.each([
    -0.001,
    100.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects score %s outside the finite 0–100 scale", (score) => {
    // Arrange
    const invalidScore = score;

    // Act
    const create = () => ReliabilityScore.from(invalidScore);

    // Assert
    expect(create).toThrow(RangeError);
  });

  test("compares scores by value", () => {
    // Arrange
    const first = ReliabilityScore.from(75.5);
    const equal = ReliabilityScore.from(75.5);
    const greater = ReliabilityScore.from(80);

    // Act
    const equalByValue = first.equals(equal);
    const differentByValue = first.equals(greater);
    const firstComparedWithEqual = first.compareTo(equal);
    const firstComparedWithGreater = first.compareTo(greater);
    const greaterComparedWithFirst = greater.compareTo(first);

    // Assert
    expect(first).not.toBe(equal);
    expect(equalByValue).toBe(true);
    expect(differentByValue).toBe(false);
    expect(firstComparedWithEqual).toBe(0);
    expect(firstComparedWithGreater).toBe(-1);
    expect(greaterComparedWithFirst).toBe(1);
  });

  test("treats the minimum threshold as inclusive", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const belowThreshold = ReliabilityScore.from(75);
    const equalThreshold = ReliabilityScore.from(75.5);
    const aboveThreshold = ReliabilityScore.from(75.5001);
    const zero = ReliabilityScore.from(0);
    const maximum = ReliabilityScore.from(100);

    // Act
    const meetsBelow = score.meetsMinimum(belowThreshold);
    const meetsEqual = score.meetsMinimum(equalThreshold);
    const meetsAbove = score.meetsMinimum(aboveThreshold);
    const zeroMeetsZero = zero.meetsMinimum(zero);
    const maximumMeetsMaximum = maximum.meetsMinimum(maximum);

    // Assert
    expect(meetsBelow).toBe(true);
    expect(meetsEqual).toBe(true);
    expect(meetsAbove).toBe(false);
    expect(zeroMeetsZero).toBe(true);
    expect(maximumMeetsMaximum).toBe(true);
  });

  test("keeps the score immutable", () => {
    // Arrange
    const score = ReliabilityScore.from(66.66666666666667);

    // Act
    const numericScore = score.toNumber();

    // Assert
    expect(Object.isFrozen(score)).toBe(true);
    expect(numericScore).toBe(66.66666666666667);
  });
});
