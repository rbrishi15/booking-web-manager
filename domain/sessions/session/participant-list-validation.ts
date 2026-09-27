import { DomainError } from "../../shared/errors";
import type { UUID } from "../../shared/types";
import type { Participation } from "../participation";

export interface ParticipantListTerms {
  readonly totalSlots: number;
  readonly holdingAccountId: UUID;
}

/** A fulfilled invitation stays in history but no longer reserves capacity. */
export function personalReplacementReservations(
  participations: readonly Participation[],
): readonly Participation[] {
  const replacedIds = new Set(
    participations.map((p) => p.replacesParticipationId),
  );
  return participations.filter(
    (p) =>
      p.status === "WITHDRAWN" &&
      p.replacementMode === "DIRECT_INVITE" &&
      (p.hold?.state === "AWAITING_REPLACEMENT" ||
        p.hold?.state === "REFUNDED") &&
      !replacedIds.has(p.participationId),
  );
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
  const replacedIds = participations
    .map((p) => p.replacesParticipationId)
    .filter((id) => id !== undefined);
  DomainError.require(
    new Set(replacedIds).size === replacedIds.length,
    "DUPLICATE_ID",
    "A participant's seat can be replaced only once",
  );
  const byParticipationId = new Map(
    participations.map((participation) => [
      participation.participationId,
      participation,
    ]),
  );
  for (const replacement of participations) {
    if (replacement.replacesParticipationId === undefined) continue;
    const replaced = byParticipationId.get(replacement.replacesParticipationId);
    DomainError.require(
      replaced !== undefined &&
        (replaced.status === "WITHDRAWN" || replaced.status === "CANCELLED") &&
        replaced.withdrawnAt !== undefined &&
        replaced.hold?.state === "REFUNDED",
      "INVALID_INPUT",
      "A replacement must refer to an existing refunded withdrawal",
    );
    DomainError.require(
      ["COMMITTED", "WITHDRAWN", "REMOVED", "CANCELLED"].includes(
        replacement.status,
      ) &&
        replacement.committedAt !== undefined &&
        replacement.hold !== undefined,
      "INVALID_INPUT",
      "Only a participation with a commitment history can replace a seat",
    );
    if (replaced.replacementMode === "DIRECT_INVITE")
      DomainError.require(
        replaced.replacementInviteeId === replacement.userId,
        "INVALID_INPUT",
        "A reserved seat can be replaced only by its named invitee",
      );
  }
  const reservations = personalReplacementReservations(participations);
  DomainError.require(
    new Set(reservations.map((p) => p.replacementInviteeId)).size ===
      reservations.length,
    "DUPLICATE_ID",
    "A person can have only one pending replacement invitation per session",
  );
  DomainError.require(
    participations.filter((p) => p.status === "COMMITTED").length +
      reservations.length <=
      terms.totalSlots,
    "CAPACITY_EXCEEDED",
    "Commitments and reserved replacement seats exceed session capacity",
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
