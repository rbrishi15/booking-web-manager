import { Money } from "@/domain";
import {
  LedgerError,
  fromDatabaseCents,
  fromOptionalDatabaseCents,
  toDatabaseCents,
} from "@/lib/money";
import { describe, expect, test } from "vitest";

describe("toDatabaseCents", () => {
  test.each([0, 1, -1, 1250, Number.MAX_SAFE_INTEGER])(
    "writes %i cents as a string, not a float",
    (cents) => {
      // Arrange
      const money = Money.fromCents(cents);

      // Act
      const parameter = toDatabaseCents(money);

      // Assert
      expect(parameter).toBe(String(cents));
      expect(typeof parameter).toBe("string");
    },
  );
});

describe("fromDatabaseCents", () => {
  test("reads the string form a bigint column returns", () => {
    // Arrange
    const column = "9007199254740991";

    // Act
    const money = fromDatabaseCents(column, "available_cents");

    // Assert
    expect(money.toCents()).toBe(Number.MAX_SAFE_INTEGER);
  });

  test.each([
    ["1250", 1250],
    ["-1250", -1250],
    ["0", 0],
  ])("reads %s as %i cents", (column, expected) => {
    // Act
    const money = fromDatabaseCents(column, "amount_cents");

    // Assert
    expect(money.toCents()).toBe(expected);
  });

  test("reads a driver that already returned a number", () => {
    // Act
    const money = fromDatabaseCents(1250, "amount_cents");

    // Assert
    expect(money.toCents()).toBe(1250);
  });

  test("reads a driver that already returned a bigint", () => {
    // Act
    const money = fromDatabaseCents(1250n, "amount_cents");

    // Assert
    expect(money.toCents()).toBe(1250);
  });

  test("refuses a value too large to survive the trip into Money", () => {
    // Arrange
    const column = "9007199254740992";

    // Act and assert
    expect(() => fromDatabaseCents(column, "available_cents")).toThrow(
      LedgerError,
    );
  });

  test.each([
    { column: "12.50", why: "a decimal string" },
    { column: "", why: "an empty string" },
    { column: "abc", why: "text" },
    { column: null, why: "null" },
    { column: undefined, why: "nothing" },
    { column: 1.5, why: "a fractional number" },
    { column: {}, why: "an object" },
  ])("refuses $why", ({ column }) => {
    // Act and assert
    expect(() => fromDatabaseCents(column, "amount_cents")).toThrow(LedgerError);
  });

  test("names the column it could not read", () => {
    // Act and assert
    expect(() => fromDatabaseCents("12.50", "available_cents")).toThrow(
      /available_cents/,
    );
  });
});

describe("fromOptionalDatabaseCents", () => {
  test.each([null, undefined])("reads %s as no amount", (column) => {
    // Act
    const money = fromOptionalDatabaseCents(column, "amount_cents");

    // Assert
    expect(money).toBeUndefined();
  });

  test("reads a present column as an amount", () => {
    // Act
    const money = fromOptionalDatabaseCents("1250", "amount_cents");

    // Assert
    expect(money?.toCents()).toBe(1250);
  });
});
