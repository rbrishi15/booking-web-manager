import { DomainError } from "../../shared/errors";
import type { UUID } from "../../shared/types";
import type { Participation } from "../participation";

export interface ParticipantListTerms {
  readonly totalSlots: number;
  readonly holdingAccountId: UUID;
}

/** Collection invariants shared by hydration and every immutable candidate. */
export function validateParticipantList(
  participations: readonly Participation[],
  nextQueueSequence: number,
  terms: ParticipantListTerms,
): void {
  validateNextQueueSequence(participations, nextQueueSequence);
  DomainError.require(
    Number.isSafeInteger(nextQueueSequence) && nextQueueSequence > 0,
    "INVALID_INPUT",
    "nextQueueSequence must be a positive safe integer",
  );
  const ids = new Set(participations.map((p) => p.userId));
  DomainError.require(
    ids.size === participations.length,
    "DUPLICATE_ID",
    "A user may participate only once in a session",
  );
  const participationIds = new Set(
    participations.map((p) => p.participationId),
  );
  DomainError.require(
    participationIds.size === participations.length,
    "DUPLICATE_ID",
    "Participation IDs must be unique in a session",
  );
  const queueSequences = participations
    .map((participation) => participation.queueSequence)
    .filter((sequence): sequence is number => sequence !== undefined);
  DomainError.require(
    new Set(queueSequences).size === queueSequences.length,
    "DUPLICATE_ID",
    "Queue sequences must be unique in a session",
  );
  const holdIds = new Set<string>();
  for (const participation of participations) {
    const hold = participation.hold;
    if (hold === undefined) continue;
    DomainError.require(
      hold.participationId === participation.participationId,
      "INVALID_INPUT",
      "A hold must belong to its participation",
    );
    DomainError.require(
      hold.holdingAccountId === terms.holdingAccountId,
      "INVALID_INPUT",
      "A session hold must use its holding account",
    );
    DomainError.require(
      !holdIds.has(hold.holdId),
      "DUPLICATE_ID",
      "Hold IDs must be unique in a session",
    );
    holdIds.add(hold.holdId);
  }
  DomainError.require(
    participations.filter((p) => p.status === "COMMITTED").length <=
      terms.totalSlots,
    "CAPACITY_EXCEEDED",
    "Committed participations exceed session capacity",
  );
}

export function validateNextQueueSequence(
  participations: readonly Participation[],
  nextQueueSequence: number,
): void {
  const maxSequence = participations.reduce(
    (max, p) => Math.max(max, p.queueSequence ?? 0),
    0,
  );
  DomainError.require(
    nextQueueSequence > maxSequence,
    "INVALID_INPUT",
    "Queue sequence must be ahead of the roster",
  );
}
