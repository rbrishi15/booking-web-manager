import { ReliabilityScore } from "@/domain";
import { describe, expect, test } from "vitest";

describe("ReliabilityScore", () => {
  test("from_WhenScoreIsZero_PreservesValue", () => {
    // Arrange
    const value = 0;

    // Act
    const score = ReliabilityScore.from(value);

    // Assert
    expect(score.toNumber()).toBe(value);
  });

  test("from_WhenScoreIsMaximum_PreservesValue", () => {
    // Arrange
    const value = 100;

    // Act
    const score = ReliabilityScore.from(value);

    // Assert
    expect(score.toNumber()).toBe(value);
  });

  test("from_WhenScoreIsWholeNumber_PreservesValue", () => {
    // Arrange
    const value = 48;

    // Act
    const score = ReliabilityScore.from(value);

    // Assert
    expect(score.toNumber()).toBe(value);
  });

  test("from_WhenScoreIsFraction_PreservesValue", () => {
    // Arrange
    const value = 66.66666666666667;

    // Act
    const score = ReliabilityScore.from(value);

    // Assert
    expect(score.toNumber()).toBe(value);
  });

  test("from_WhenScoreIsNegativeZero_NormalizesToZero", () => {
    // Arrange
    const score = -0;

    // Act
    const reliability = ReliabilityScore.from(score);

    // Assert
    expect(reliability.toNumber()).toBe(0);
  });

  test("from_WhenScoreIsBelowZero_ThrowsRangeError", () => {
    // Arrange
    const value = -0.001;

    // Act & Assert
    expect(() => ReliabilityScore.from(value)).toThrow(RangeError);
  });

  test("from_WhenScoreIsAboveMaximum_ThrowsRangeError", () => {
    // Arrange
    const value = 100.001;

    // Act & Assert
    expect(() => ReliabilityScore.from(value)).toThrow(RangeError);
  });

  test("from_WhenScoreIsNaN_ThrowsRangeError", () => {
    // Arrange
    const value = Number.NaN;

    // Act & Assert
    expect(() => ReliabilityScore.from(value)).toThrow(RangeError);
  });

  test("from_WhenScoreIsPositiveInfinity_ThrowsRangeError", () => {
    // Arrange
    const value = Number.POSITIVE_INFINITY;

    // Act & Assert
    expect(() => ReliabilityScore.from(value)).toThrow(RangeError);
  });

  test("from_WhenScoreIsNegativeInfinity_ThrowsRangeError", () => {
    // Arrange
    const value = Number.NEGATIVE_INFINITY;

    // Act & Assert
    expect(() => ReliabilityScore.from(value)).toThrow(RangeError);
  });

  test("equals_WhenValuesAreEqual_ReturnsTrue", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const other = ReliabilityScore.from(75.5);

    // Act
    const comparison = score.equals(other);

    // Assert
    expect(score).not.toBe(other);
    expect(comparison).toBe(true);
  });

  test("equals_WhenValuesDiffer_ReturnsFalse", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const other = ReliabilityScore.from(80);

    // Act
    const comparison = score.equals(other);

    // Assert
    expect(comparison).toBe(false);
  });

  test("compareTo_WhenValuesAreEqual_ReturnsZero", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const other = ReliabilityScore.from(75.5);

    // Act
    const comparison = score.compareTo(other);

    // Assert
    expect(comparison).toBe(0);
  });

  test("compareTo_WhenValueIsSmaller_ReturnsNegativeOne", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const other = ReliabilityScore.from(80);

    // Act
    const comparison = score.compareTo(other);

    // Assert
    expect(comparison).toBe(-1);
  });

  test("compareTo_WhenValueIsGreater_ReturnsOne", () => {
    // Arrange
    const score = ReliabilityScore.from(80);
    const other = ReliabilityScore.from(75.5);

    // Act
    const comparison = score.compareTo(other);

    // Assert
    expect(comparison).toBe(1);
  });

  test("meetsMinimum_WhenAboveThreshold_ReturnsTrue", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const threshold = ReliabilityScore.from(75);

    // Act
    const meetsThreshold = score.meetsMinimum(threshold);

    // Assert
    expect(meetsThreshold).toBe(true);
  });

  test("meetsMinimum_WhenAtThreshold_ReturnsTrue", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const threshold = ReliabilityScore.from(75.5);

    // Act
    const meetsThreshold = score.meetsMinimum(threshold);

    // Assert
    expect(meetsThreshold).toBe(true);
  });

  test("meetsMinimum_WhenBelowThreshold_ReturnsFalse", () => {
    // Arrange
    const score = ReliabilityScore.from(75.5);
    const threshold = ReliabilityScore.from(75.5001);

    // Act
    const meetsThreshold = score.meetsMinimum(threshold);

    // Assert
    expect(meetsThreshold).toBe(false);
  });

  test("meetsMinimum_WhenBothZero_ReturnsTrue", () => {
    // Arrange
    const score = ReliabilityScore.from(0);
    const threshold = ReliabilityScore.from(0);

    // Act
    const meetsThreshold = score.meetsMinimum(threshold);

    // Assert
    expect(meetsThreshold).toBe(true);
  });

  test("meetsMinimum_WhenBothMaximum_ReturnsTrue", () => {
    // Arrange
    const score = ReliabilityScore.from(100);
    const threshold = ReliabilityScore.from(100);

    // Act
    const meetsThreshold = score.meetsMinimum(threshold);

    // Assert
    expect(meetsThreshold).toBe(true);
  });

  test("toNumber_WhenScoreIsFractional_PreservesImmutableValue", () => {
    // Arrange
    const score = ReliabilityScore.from(66.66666666666667);

    // Act
    const numericScore = score.toNumber();

    // Assert
    expect(Object.isFrozen(score)).toBe(true);
    expect(numericScore).toBe(66.66666666666667);
  });
});
