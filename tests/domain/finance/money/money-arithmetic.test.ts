import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("fromCents_WhenCreated_ReturnsFrozenInstance", () => {
    // Arrange
    const cents = 500;

    // Act
    const money = Money.fromCents(cents);

    // Assert
    expect(Object.isFrozen(money)).toBe(true);
  });

  test("add_WhenBothAmountsArePositive_ReturnsTheirSum", () => {
    // Arrange
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);

    // Act
    const sum = first.add(second);

    // Assert
    expect(sum.toCents()).toBe(1200);
  });

  test("add_WhenChainedAfterSubtraction_ReturnsExactAmount", () => {
    // Arrange
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);

    // Act
    const combined = first.subtract(second).add(first);

    // Assert
    expect(combined.toCents()).toBe(300);
  });

  test("add_WhenAddingZero_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const sum = money.add(Money.fromCents(0));

    // Assert
    expect(sum).not.toBe(money);
  });

  test("add_WhenAppliedToOperands_PreservesBothValues", () => {
    // Arrange
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);

    // Act
    first.add(second);

    // Assert
    expect(first.toCents()).toBe(500);
    expect(second.toCents()).toBe(700);
  });

  test("subtract_WhenSecondAmountIsLarger_ReturnsNegativeDifference", () => {
    // Arrange
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);

    // Act
    const difference = first.subtract(second);

    // Assert
    expect(difference.toCents()).toBe(-200);
  });

  test("subtract_WhenAmountIsNegative_IncreasesValue", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const difference = money.subtract(Money.fromCents(-100));

    // Assert
    expect(difference.toCents()).toBe(600);
  });

  test("subtract_WhenSubtractingZero_ReturnsNewInstance", () => {
    // Arrange
    const money = Money.fromCents(500);

    // Act
    const difference = money.subtract(Money.fromCents(0));

    // Assert
    expect(difference).not.toBe(money);
  });

  test("subtract_WhenAppliedToOperands_PreservesBothValues", () => {
    // Arrange
    const first = Money.fromCents(500);
    const second = Money.fromCents(700);

    // Act
    first.subtract(second);

    // Assert
    expect(first.toCents()).toBe(500);
    expect(second.toCents()).toBe(700);
  });
});
