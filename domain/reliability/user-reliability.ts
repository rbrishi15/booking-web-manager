import type { UUID } from "../shared/types";
import type { ReliabilityScore } from "./reliability-score";
import { ReliabilityScore as ReliabilityScoreValue } from "./reliability-score";

/** A calculated view of participation history, not an independently editable score. */
export interface UserReliability {
  readonly userId: UUID;
  readonly reliabilityScore: ReliabilityScore;
  /** The calculation's asOf instant. Each read returns a defensive Date copy. */
  readonly calculatedAt: Date;
}

/** Creates a defensive read model from a derived score. */
export function createUserReliability(
  userId: UUID,
  reliabilityScore: ReliabilityScore,
  calculatedAt: Date,
): UserReliability {
  if (typeof userId !== "string" || userId.trim() === "")
    throw new RangeError("userId is required");
  if (!(reliabilityScore instanceof ReliabilityScoreValue))
    throw new RangeError("reliabilityScore must be a ReliabilityScore");
  if (
    !(calculatedAt instanceof Date) ||
    !Number.isFinite(calculatedAt.getTime())
  ) {
    throw new RangeError("calculatedAt must be a valid Date");
  }
  const instant = calculatedAt.getTime();
  return Object.freeze({
    userId,
    reliabilityScore,
    get calculatedAt(): Date {
      return new Date(instant);
    },
  });
}
