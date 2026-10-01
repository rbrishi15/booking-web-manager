import { Money } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Money", () => {
  test("toDollars_WhenZero_ReturnsTwoDecimalPlaces", () => {
    // Arrange
    const money = Money.fromCents(0);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("0.00");
  });

  test("toDollars_WhenOneCent_PadsTheFraction", () => {
    // Arrange
    const money = Money.fromCents(1);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("0.01");
  });

  test("toDollars_WhenWholeDollars_PreservesTwoDecimalPlaces", () => {
    // Arrange
    const money = Money.fromCents(1000);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("10.00");
  });

  test("toDollars_WhenFractionalDollars_ReturnsExactAmount", () => {
    // Arrange
    const money = Money.fromCents(333);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("3.33");
  });

  test("toDollars_WhenNegativeCent_PreservesSign", () => {
    // Arrange
    const money = Money.fromCents(-1);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("-0.01");
  });

  test("toDollars_WhenNegativeDollars_ReturnsExactAmount", () => {
    // Arrange
    const money = Money.fromCents(-333);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("-3.33");
  });

  test("toDollars_WhenMaximumSafeInteger_PreservesEveryCent", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("90071992547409.91");
  });

  test("toDollars_WhenMinimumSafeInteger_PreservesEveryCent", () => {
    // Arrange
    const money = Money.fromCents(Number.MIN_SAFE_INTEGER);

    // Act
    const dollars = money.toDollars();

    // Assert
    expect(dollars).toBe("-90071992547409.91");
  });
});
