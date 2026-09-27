import { Money } from "@/domain";
import { LedgerError } from "./errors";

/**
 * The boundary between `bigint` columns and the `Money` type.
 *
 * Drivers return `bigint` as a string by default, precisely so that values
 * above 2^53 are not silently mangled by JavaScript's number type. That string
 * is the safe form, so it is what this module reads, and a value that could not
 * survive the trip into `Money` is rejected rather than rounded.
 *
 * Nothing here parses a decimal. There is no float anywhere in the path from
 * the column to the domain type; formatting to "SGD 12.34" happens at the
 * render layer with `Intl.NumberFormat`.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_PATTERN = /^-?\d+$/;

/** Renders a `Money` for a `bigint` parameter. */
export function toDatabaseCents(money: Money): string {
  return money.toCents().toString();
}

/** Reads a `bigint` column into `Money`, rejecting anything lossy. */
export function fromDatabaseCents(value: unknown, column: string): Money {
  return Money.fromCents(Number(readBigInt(value, column)));
}

/** As `fromDatabaseCents`, but a null column reads as no value. */
export function fromOptionalDatabaseCents(
  value: unknown,
  column: string,
): Money | undefined {
  if (value === null || value === undefined) return undefined;
  return fromDatabaseCents(value, column);
}

function readBigInt(value: unknown, column: string): bigint {
  const cents = parse(value, column);

  if (cents > MAX_SAFE || cents < -MAX_SAFE) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `${column} holds ${cents} cents, which exceeds the safe integer range Money accepts`,
    );
  }

  return cents;
}

function parse(value: unknown, column: string): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "string") {
    if (!INTEGER_PATTERN.test(value)) {
      throw new LedgerError(
        "INVARIANT_VIOLATED",
        `${column} holds ${JSON.stringify(value)}, which is not an integer number of cents`,
      );
    }
    return BigInt(value);
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new LedgerError(
        "INVARIANT_VIOLATED",
        `${column} holds ${value}, which is not a safe integer number of cents`,
      );
    }
    return BigInt(value);
  }

  throw new LedgerError(
    "INVARIANT_VIOLATED",
    `${column} holds ${value === null ? "null" : typeof value}, which is not a cent amount`,
  );
}
