import { DomainError, Money } from "@/domain";
import { allocate, bookingShare, formatSgd, sumOf } from "@/lib/money";
import { describe, expect, test } from "vitest";

describe("bookingShare", () => {
  test("divides a cost that splits evenly", () => {
    // Arrange
    const totalCost = Money.fromCents(9000);

    // Act
    const result = bookingShare(totalCost, 6);

    // Assert
    expect(result.share.toCents()).toBe(1500);
    expect(result.collected.toCents()).toBe(9000);
    expect(result.bookerShortfall.toCents()).toBe(0);
  });

  test("rounds the share down and leaves the remainder with the booker", () => {
    // Arrange
    const totalCost = Money.fromCents(1000);

    // Act
    const result = bookingShare(totalCost, 3);

    // Assert
    expect(result.share.toCents()).toBe(333);
    expect(result.collected.toCents()).toBe(999);
    expect(result.bookerShortfall.toCents()).toBe(1);
  });

  test.each([
    [10_000, 7],
    [8350, 4],
    [1, 1],
    [999_999, 13],
  ])(
    "never charges more than an equal split of %i cents across %i slots",
    (cents, slots) => {
      // Arrange
      const totalCost = Money.fromCents(cents);

      // Act
      const result = bookingShare(totalCost, slots);

      // Assert
      expect(result.share.toCents() * slots).toBeLessThanOrEqual(cents);
      expect(result.bookerShortfall.toCents()).toBeGreaterThanOrEqual(0);
      expect(result.bookerShortfall.toCents()).toBeLessThan(slots);
      expect(
        result.collected.add(result.bookerShortfall).toCents(),
      ).toBe(cents);
    },
  );

  test("refuses a cost too small to give every slot a cent", () => {
    // Arrange
    const totalCost = Money.fromCents(5);

    // Act and assert
    expect(() => bookingShare(totalCost, 8)).toThrow(DomainError);
  });

  test.each([0, -1, 1.5, Number.NaN])("refuses %s slots", (slots) => {
    // Arrange
    const totalCost = Money.fromCents(9000);

    // Act and assert
    expect(() => bookingShare(totalCost, slots)).toThrow(DomainError);
  });

  test("refuses a cost that is not positive", () => {
    // Arrange
    const totalCost = Money.fromCents(0);

    // Act and assert
    expect(() => bookingShare(totalCost, 4)).toThrow(DomainError);
  });
});

describe("allocate", () => {
  test("spreads the remainder one cent at a time over the earliest parts", () => {
    // Arrange
    const total = Money.fromCents(1000);

    // Act
    const parts = allocate(total, 3);

    // Assert
    expect(parts.map((part) => part.toCents())).toEqual([334, 333, 333]);
  });

  test.each([
    [1000, 3],
    [1, 1],
    [7, 7],
    [12_345, 11],
    [99, 100],
  ])("conserves %i cents across %i parts", (cents, parts) => {
    // Arrange
    const total = Money.fromCents(cents);

    // Act
    const allocated = allocate(total, parts);

    // Assert
    expect(allocated).toHaveLength(parts);
    expect(sumOf(allocated).toCents()).toBe(cents);
  });

  test("keeps every part within a cent of every other", () => {
    // Arrange
    const total = Money.fromCents(100_003);

    // Act
    const amounts = allocate(total, 7).map((part) => part.toCents());

    // Assert
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  test("allocates nothing from nothing", () => {
    // Arrange
    const total = Money.fromCents(0);

    // Act
    const parts = allocate(total, 4);

    // Assert
    expect(parts.map((part) => part.toCents())).toEqual([0, 0, 0, 0]);
  });

  test("refuses a negative total", () => {
    // Arrange
    const total = Money.fromCents(-1);

    // Act and assert
    expect(() => allocate(total, 2)).toThrow(DomainError);
  });
});

describe("sumOf", () => {
  test("adds nothing to zero", () => {
    // Arrange
    const amounts: Money[] = [];

    // Act
    const total = sumOf(amounts);

    // Assert
    expect(total.toCents()).toBe(0);
  });

  test("adds every amount", () => {
    // Arrange
    const amounts = [1250, 999, 1].map((cents) => Money.fromCents(cents));

    // Act
    const total = sumOf(amounts);

    // Assert
    expect(total.toCents()).toBe(2250);
  });
});

describe("formatSgd", () => {
  test.each([
    [0, "S$0.00"],
    [5, "S$0.05"],
    [50, "S$0.50"],
    [1250, "S$12.50"],
    [100_000, "S$1,000.00"],
    [-1250, "-S$12.50"],
  ])("renders %i cents as %s", (cents, expected) => {
    // Arrange
    const money = Money.fromCents(cents);

    // Act
    const rendered = formatSgd(money);

    // Assert
    expect(rendered).toBe(expected);
  });

  test("keeps every digit at the top of the safe integer range", () => {
    // Arrange
    const money = Money.fromCents(Number.MAX_SAFE_INTEGER);

    // Act
    const rendered = formatSgd(money);

    // Assert
    expect(rendered).toBe("S$90,071,992,547,409.91");
  });
});
