import { Money, requireDomain } from "@/domain";

/**
 * Splitting money without losing cents.
 *
 * `Money.divideFloor` answers "what is a third of this?" but not "how do I
 * split this into three parts that add back up?". Those are different
 * questions, and only the second one keeps the ledger balanced: a total of
 * SGD 10.00 across three people is not three lots of SGD 3.33, because that is
 * SGD 9.99 and a cent has gone missing. Every function here states exactly
 * where the odd cents land.
 */

/** The outcome of dividing a booking cost across its slots (REQ-20). */
export interface BookingShare {
  /** What each participant owes. Equal for everyone, so the room shows one figure. */
  readonly share: Money;
  readonly slots: number;
  /** `share` times `slots`: what the booker recovers if every slot fills. */
  readonly collected: Money;
  /**
   * The remainder the booker carries, from 0 to `slots - 1` cents.
   *
   * The share is rounded down rather than up so that no participant is ever
   * charged more than an equal split. The booker, who chose the venue and the
   * slot count, absorbs the few cents that will not divide.
   */
  readonly bookerShortfall: Money;
}

/**
 * Divides a booking cost into equal per-participant shares, rounding down.
 *
 * @throws DomainError when the cost will not divide into a share of at least
 * one cent, since a zero-cent hold is not a thing the ledger can record.
 */
export function bookingShare(totalCost: Money, slots: number): BookingShare {
  requireMoney(totalCost, "totalCost");
  requireDomain(
    totalCost.toCents() > 0,
    "INVALID_INPUT",
    "A booking cost must be positive",
  );
  requireCount(slots, "slots");
  requireDomain(
    totalCost.toCents() >= slots,
    "INVALID_INPUT",
    `A booking cost of ${totalCost.toCents()} cents cannot be divided across ${slots} slots without a zero share`,
  );

  const share = totalCost.divideFloor(slots);
  const collected = share.multiply(slots);

  return {
    share,
    slots,
    collected,
    bookerShortfall: totalCost.subtract(collected),
  };
}

/**
 * Splits a total into `parts` amounts that sum back to it exactly.
 *
 * The remainder is spread one cent at a time over the earliest parts, so the
 * largest and smallest differ by at most a cent. Use this wherever the sum has
 * to be conserved, such as dividing a refund; use `bookingShare` where every
 * participant must be quoted the same figure.
 */
export function allocate(total: Money, parts: number): readonly Money[] {
  requireMoney(total, "total");
  requireDomain(
    total.toCents() >= 0,
    "INVALID_INPUT",
    "Cannot allocate a negative total",
  );
  requireCount(parts, "parts");

  const base = total.divideFloor(parts);
  const remainder = total.subtract(base.multiply(parts)).toCents();
  const one = Money.fromCents(1);

  return Array.from({ length: parts }, (_unused, index) =>
    index < remainder ? base.add(one) : base,
  );
}

/** Adds amounts, returning zero for an empty list. */
export function sumOf(amounts: Iterable<Money>): Money {
  let total = Money.fromCents(0);
  for (const amount of amounts) {
    requireMoney(amount, "amount");
    total = total.add(amount);
  }
  return total;
}

const WHOLE_UNITS = new Intl.NumberFormat("en-SG", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/**
 * Formats an amount for display, to two decimals.
 *
 * The dollars and the cents are separated by integer arithmetic and only the
 * dollar part is handed to `Intl`, so the value never becomes a float. Passing
 * `cents / 100` straight to a currency formatter would read correctly for small
 * amounts and quietly lose precision for large ones, which is the class of bug
 * the integer-cents rule exists to prevent.
 *
 * Presentation only. The string it returns must never be parsed back into a
 * number and fed into a calculation.
 */
export function formatSgd(money: Money): string {
  requireMoney(money, "money");

  const cents = money.toCents();
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const fraction = absolute % 100;
  // The numerator is an exact multiple of 100, so this division is exact for
  // every safe integer.
  const dollars = (absolute - fraction) / 100;

  return `${sign}S$${WHOLE_UNITS.format(dollars)}.${String(fraction).padStart(2, "0")}`;
}

function requireMoney(value: Money, name: string): void {
  requireDomain(
    value instanceof Money,
    "INVALID_INPUT",
    `${name} must be a Money amount`,
  );
}

function requireCount(value: number, name: string): void {
  requireDomain(
    Number.isSafeInteger(value) && value > 0,
    "INVALID_INPUT",
    `${name} must be a positive whole number`,
  );
}
