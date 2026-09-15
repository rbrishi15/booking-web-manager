/** A validated immutable score on the 0–100 scale; calculation and display are separate. */
export class ReliabilityScore {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value === 0 ? 0 : value;
    Object.freeze(this);
  }

  static from(value: number): ReliabilityScore {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new RangeError(
        "Reliability score must be a finite number from 0 to 100",
      );
    }

    return new ReliabilityScore(value);
  }

  toNumber(): number {
    return this.#value;
  }

  equals(other: ReliabilityScore): boolean {
    assertScore(other);
    return this.#value === other.#value;
  }

  compareTo(other: ReliabilityScore): -1 | 0 | 1 {
    assertScore(other);
    if (this.#value < other.#value) return -1;
    if (this.#value > other.#value) return 1;
    return 0;
  }

  meetsMinimum(minimum: ReliabilityScore): boolean {
    assertScore(minimum);
    return this.compareTo(minimum) >= 0;
  }
}

function assertScore(
  value: ReliabilityScore,
): asserts value is ReliabilityScore {
  if (!(value instanceof ReliabilityScore))
    throw new RangeError("Reliability comparison requires another score");
}
