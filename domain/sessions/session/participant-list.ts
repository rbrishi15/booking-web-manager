import type { Money } from "../../finance/money";
import { DomainError } from "../../shared/errors";
import type { SettlementLine } from "../../shared/operations";
import type { UUID } from "../../shared/types";
import type { Participation } from "../participation";
import {
  validateAdmission,
  validateAttendanceChanges,
  validateCancellation,
  validateParticipationTransition,
  validateSettlementParticipations,
} from "./session-recording";
import {
  type ParticipantListTerms,
  validateParticipantList,
} from "./participant-list-validation";

/** Read-only participation collection at one point in the Session's lifecycle. */
export interface ParticipantListView {
  readonly participations: readonly Participation[];
  readonly nextQueueSequence: number;
  readonly committedCount: number;
  requireParticipation(id: UUID): Participation;
  findByUserId(userId: UUID): Participation | undefined;
  nextWaitlisted(): Participation | undefined;
  oldestAwaitingReplacement(): Participation | undefined;
}

interface ParticipantListDetails {
  readonly participations: readonly Participation[];
  readonly nextQueueSequence: number;
}

/**
 * Immutable child owned by Session. Maps retain the complete participation
 * history in roster order. Bounded operations prepare new lists; only Session
 * can install one together with its lifecycle and payout state.
 */
export class ParticipantList implements ParticipantListView {
  readonly #byId: ReadonlyMap<UUID, Participation>;
  readonly #idByUser: ReadonlyMap<UUID, UUID>;
  readonly #nextQueueSequence: number;
  readonly #terms: ParticipantListTerms;

  constructor(details: ParticipantListDetails, terms: ParticipantListTerms) {
    // Check duplicates before Map construction could silently discard them.
    validateParticipantList(
      details.participations,
      details.nextQueueSequence,
      terms,
    );
    this.#byId = new Map(
      details.participations.map((p) => [p.participationId, p]),
    );
    this.#idByUser = new Map(
      details.participations.map((p) => [p.userId, p.participationId]),
    );
    this.#nextQueueSequence = details.nextQueueSequence;
    this.#terms = { ...terms };
  }

  get participations(): readonly Participation[] {
    return [...this.#byId.values()];
  }

  get nextQueueSequence(): number {
    return this.#nextQueueSequence;
  }

  get committedCount(): number {
    let count = 0;
    for (const participation of this.#byId.values())
      if (participation.status === "COMMITTED") count += 1;
    return count;
  }

  requireParticipation(id: UUID): Participation {
    const participation = this.#byId.get(id);
    if (participation === undefined)
      throw new DomainError("NOT_FOUND", "Participation was not found");
    return participation;
  }

  /** Internal optional lookup used by admission's duplicate-ID check. */
  findParticipation(id: UUID): Participation | undefined {
    return this.#byId.get(id);
  }

  findByUserId(userId: UUID): Participation | undefined {
    const id = this.#idByUser.get(userId);
    return id === undefined ? undefined : this.#byId.get(id);
  }

  nextWaitlisted(): Participation | undefined {
    let next: Participation | undefined;
    for (const participation of this.#byId.values()) {
      if (participation.status !== "WAITLISTED") continue;
      if (
        next === undefined ||
        (participation.queueSequence ?? 0) < (next.queueSequence ?? 0)
      )
        next = participation;
    }
    return next;
  }

  oldestAwaitingReplacement(): Participation | undefined {
    let oldest: Participation | undefined;
    for (const participation of this.#byId.values()) {
      if (
        participation.status !== "WITHDRAWN" ||
        participation.hold?.state !== "AWAITING_REPLACEMENT"
      )
        continue;
      // Strict comparison retains original roster order for equal timestamps.
      if (
        oldest === undefined ||
        (participation.withdrawnAt?.getTime() ?? 0) <
          (oldest.withdrawnAt?.getTime() ?? 0)
      )
        oldest = participation;
    }
    return oldest;
  }

  withAdmission(
    admission: Participation,
    refundedReplacement: Participation | undefined,
    now: Date,
    expectedShare: Money,
  ): ParticipantList {
    validateAdmission(
      this,
      admission,
      refundedReplacement,
      this.#terms.totalSlots,
      now,
    );
    if (admission.hold !== undefined)
      DomainError.require(
        admission.hold.amount.equals(expectedShare),
        "INVALID_INPUT",
        "An admission hold must match the booking share",
      );
    const next = new Map(this.#byId);
    next.set(admission.participationId, admission);
    if (refundedReplacement !== undefined)
      next.set(refundedReplacement.participationId, refundedReplacement);
    return new ParticipantList(
      {
        participations: [...next.values()],
        nextQueueSequence:
          this.#nextQueueSequence + (admission.status === "WAITLISTED" ? 1 : 0),
      },
      this.#terms,
    );
  }

  withParticipationTransition(
    existing: Participation,
    replacement: Participation,
    now?: Date,
  ): ParticipantList {
    DomainError.require(
      this.requireParticipation(existing.participationId) === existing,
      "INVALID_STATE",
      "The participation is not the current owned record",
    );
    validateParticipationTransition(existing, replacement, now);
    return this.withReplacements([replacement]);
  }

  withCancellation(
    cancelled: readonly Participation[],
    now: Date,
  ): ParticipantList {
    validateCancellation(this, cancelled, now);
    return new ParticipantList(
      { participations: cancelled, nextQueueSequence: this.#nextQueueSequence },
      this.#terms,
    );
  }

  withAttendance(
    verified: readonly Participation[],
    now: Date,
  ): ParticipantList {
    validateAttendanceChanges(this, verified, now);
    return this.withReplacements(verified);
  }

  withSettlementPreparation(
    participations: readonly Participation[],
  ): ParticipantList {
    validateSettlementParticipations(this, participations);
    return new ParticipantList(
      { participations, nextQueueSequence: this.#nextQueueSequence },
      this.#terms,
    );
  }

  withExpiredReplacements(now: Date): ParticipantList {
    return this.withReplacements(
      this.participations.map((participation) =>
        participation.expireReplacement(now),
      ),
    );
  }

  withAutomaticAttendance(now: Date): ParticipantList {
    return this.withReplacements(
      this.participations.map((participation) =>
        participation.status === "COMMITTED" &&
        participation.attendance === "UNVERIFIED"
          ? participation.verify("ATTENDED", "AUTOMATIC", now)
          : participation,
      ),
    );
  }

  withCompletedSettlement(
    lines: readonly SettlementLine[],
    payoutId: UUID,
    at: Date,
  ): ParticipantList {
    const settled: Participation[] = [];
    for (const line of lines) {
      const participation = this.requireParticipation(line.participationId);
      DomainError.require(
        participation.hold?.holdId === line.holdId,
        "INVALID_STATE",
        "Settlement hold no longer matches the batch",
      );
      settled.push(participation.settleHold(line.kind, payoutId, at));
    }
    return this.withReplacements(settled);
  }

  get hasCompleteAttendance(): boolean {
    for (const participation of this.#byId.values())
      if (
        participation.status === "COMMITTED" &&
        participation.attendance === "UNVERIFIED"
      )
        return false;
    return true;
  }

  private withReplacements(
    replacements: readonly Participation[],
  ): ParticipantList {
    const next = new Map(this.#byId);
    for (const replacement of replacements) {
      this.requireParticipation(replacement.participationId);
      next.set(replacement.participationId, replacement);
    }
    return new ParticipantList(
      {
        participations: [...next.values()],
        nextQueueSequence: this.#nextQueueSequence,
      },
      this.#terms,
    );
  }
}
