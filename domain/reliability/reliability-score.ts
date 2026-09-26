import type { Participation } from "../sessions/participation";
import { copyDate } from "../shared/date";
import type { UUID } from "../shared/types";

export interface ParticipationHistoryEntry {
  readonly participation: Participation;
  /** Session end determines age; verification/forfeiture time determines eligibility. */
  readonly endAt: Date;
}

const DEFAULT_RELIABILITY_SCORE = 100;
const HALF_LIFE_DAYS = 90;
const MILLISECONDS_PER_DAY = 86_400_000;
const DECAY_CONSTANT = Math.LN2 / HALF_LIFE_DAYS;

interface Outcome {
  readonly endAt: number;
  readonly value: 0 | 1;
}

/** An immutable score on the 0–100 scale, calculated from participation history. */
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

  /** Calculates a score from one user's history at an explicit cutoff, without IO. */
  static fromHistory(
    userId: UUID,
    history: readonly ParticipationHistoryEntry[],
    asOf: Date,
  ): ReliabilityScore {
    const cutoff = copyDate(asOf, "asOf").getTime();
    const seen = new Set<UUID>();
    const outcomes: Outcome[] = [];
    let newestEnd = Number.NEGATIVE_INFINITY;

    for (const entry of history) {
      const participation = entry.participation;
      const endAt = copyDate(entry.endAt, "endAt").getTime();

      if (participation.userId !== userId) {
        throw new RangeError(
          "Reliability history must belong to the requested user",
        );
      }
      if (seen.has(participation.participationId)) {
        throw new RangeError(
          "Reliability history contains a duplicate participation",
        );
      }
      seen.add(participation.participationId);

      if (endAt > cutoff) continue;

      const outcome = participation.reliabilityOutcome(asOf);
      if (outcome === undefined || outcome.finalizedAt.getTime() > cutoff)
        continue;
      outcomes.push({ endAt, value: outcome.value });
      newestEnd = Math.max(newestEnd, endAt);
    }

    if (outcomes.length === 0) {
      return ReliabilityScore.from(DEFAULT_RELIABILITY_SCORE);
    }

    let weightedSum = 0;
    let totalWeight = 0;
    for (const outcome of outcomes) {
      // The common decay since the newest outcome cancels in the weighted ratio.
      // Its weight is always 1, avoiding a zero denominator for very old histories.
      const relativeAgeDays =
        (newestEnd - outcome.endAt) / MILLISECONDS_PER_DAY;
      const weight = Math.exp(-DECAY_CONSTANT * relativeAgeDays);
      weightedSum += weight * outcome.value;
      totalWeight += weight;
    }

    return ReliabilityScore.from(
      Math.min(100, Math.max(0, (weightedSum / totalWeight) * 100)),
    );
  }

  toNumber(): number {
    return this.#value;
  }

  equals(other: ReliabilityScore): boolean {
    return this.#value === other.#value;
  }

  compareTo(other: ReliabilityScore): -1 | 0 | 1 {
    if (this.#value < other.#value) return -1;
    if (this.#value > other.#value) return 1;
    return 0;
  }

  meetsMinimum(minimum: ReliabilityScore): boolean {
    return this.compareTo(minimum) >= 0;
  }
}
