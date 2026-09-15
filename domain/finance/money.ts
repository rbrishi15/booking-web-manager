/** An immutable SGD amount represented by an exact, safe integer number of cents. */
export class Money {
  readonly #cents: number;

  private constructor(cents: number) {
    this.#cents = cents === 0 ? 0 : cents;
    Object.freeze(this);
  }

  static fromCents(cents: number): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new RangeError("Money requires a safe integer number of SGD cents");
    }

    return new Money(cents);
  }

  toCents(): number {
    return this.#cents;
  }

  equals(other: Money): boolean {
    assertMoney(other);
    return this.#cents === other.#cents;
  }

  compareTo(other: Money): -1 | 0 | 1 {
    assertMoney(other);
    if (this.#cents < other.#cents) return -1;
    if (this.#cents > other.#cents) return 1;
    return 0;
  }

  add(other: Money): Money {
    assertMoney(other);
    return Money.fromBigInt(BigInt(this.#cents) + BigInt(other.#cents));
  }

  subtract(other: Money): Money {
    assertMoney(other);
    return Money.fromBigInt(BigInt(this.#cents) - BigInt(other.#cents));
  }

  multiply(factor: number): Money {
    if (!Number.isSafeInteger(factor)) {
      throw new RangeError(
        "Money multiplication requires a safe integer factor",
      );
    }

    return Money.fromBigInt(BigInt(this.#cents) * BigInt(factor));
  }

  /** Divide exact integer cents, rounding toward negative infinity. */
  divideFloor(divisor: number): Money {
    if (!Number.isSafeInteger(divisor) || divisor <= 0) {
      throw new RangeError(
        "Money division requires a positive safe integer divisor",
      );
    }

    const cents = BigInt(this.#cents);
    const denominator = BigInt(divisor);
    const quotient = cents / denominator;
    // BigInt division truncates toward zero; a negative remainder needs one cent less.
    const floored = cents % denominator < 0n ? quotient - 1n : quotient;
    return Money.fromBigInt(floored);
  }

  private static fromBigInt(cents: bigint): Money {
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    if (cents < -maximum || cents > maximum) {
      throw new RangeError("Money arithmetic overflowed safe integer cents");
    }
    return new Money(Number(cents));
  }
}

function assertMoney(value: Money): asserts value is Money {
  if (!(value instanceof Money))
    throw new RangeError("Money arithmetic requires another Money value");
}
