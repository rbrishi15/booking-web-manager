import type { Money } from "../../finance/money";
import type { ReliabilityScore } from "../../reliability/reliability-score";
import { DomainError } from "../../shared/errors";
import type { FinancialResult, SettlementBatch } from "../../shared/operations";
import type { SessionStatus, Visibility } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import type { Participation } from "../participation";
import {
  attendanceStatus,
  autoVerifyAttendance,
  availableSlots,
  expireReplacements,
  nextWaitlisted,
  replaceParticipation,
  requireParticipation,
} from "./session-roster";
import { completeSettlement } from "./session-settlement";
import {
  assertAttendanceOpen,
  assertOpen,
  assertOpenBefore,
  assertSettlementOpen,
  validatePayoutAttempt,
} from "./session-guards";
import {
  validateAdmission,
  validateAttendanceChanges,
  validateCancellation,
  validateParticipationTransition,
  validateSettlementPreparation,
} from "./session-recording";
import {
  cloneBatch,
  requireId,
  validDate,
  validateSessionDetails,
  validateSessionRoster,
} from "./session-validation";

export interface SessionDetails {
  readonly sessionId: UUID;
  readonly bookerId: UUID;
  readonly invitedGroupId?: UUID;
  readonly booking: Booking;
  readonly totalSlots: number;
  readonly minimumHeadcount: number;
  readonly visibility: Visibility;
  readonly status: SessionStatus;
  readonly minimumReliability?: ReliabilityScore;
  readonly roomToken: string;
  readonly holdingAccountId: UUID;
  readonly participations: readonly Participation[];
  readonly nextQueueSequence: number;
  readonly pendingSettlement?: SettlementBatch;
  readonly payoutAttemptIds?: readonly UUID[];
  readonly payoutIdempotencyKeys?: readonly string[];
}

/** Prepared settlement values recorded together; this is not an actor command. */
export interface SessionSettlementPreparation {
  readonly payoutId: UUID;
  readonly idempotencyKey: string;
  readonly participations: readonly Participation[];
  readonly batch?: SettlementBatch;
}

interface PayoutPending {
  readonly batch: SettlementBatch;
}

/**
 * Aggregate root: Session.
 * Owns Booking, Participation/FundHold children, the queue,
 * attendance, and settlement history. Roles authorize and run user workflows;
 * these bounded recording operations validate and atomically install their
 * prepared children. They never invoke roles or reconstruct financial results.
 * System attendance, replacement expiry, and payout callbacks remain here.
 * See ADR-0003 and ADR-0009. Persistence/ledger atomicity belongs to use cases.
 */
export class Session {
  readonly #sessionId: UUID;
  readonly #bookerId: UUID;
  readonly #booking: Booking;
  readonly #totalSlots: number;
  readonly #minimumHeadcount: number;
  readonly #roomToken: string;
  readonly #holdingAccountId: UUID;
  readonly #minimumReliability?: ReliabilityScore;
  #visibility: Visibility;
  #status: SessionStatus;
  #invitedGroupId?: UUID;
  #participations: Participation[];
  #nextQueueSequence: number;
  #pendingSettlement?: PayoutPending;
  #payoutAttemptIds: Set<UUID>;
  #payoutIdempotencyKeys: Set<string>;

  constructor(details: SessionDetails) {
    validateSessionDetails(details);

    this.#sessionId = details.sessionId;
    this.#bookerId = details.bookerId;
    this.#booking = details.booking;
    this.#totalSlots = details.totalSlots;
    this.#minimumHeadcount = details.minimumHeadcount;
    this.#roomToken = details.roomToken;
    this.#holdingAccountId = details.holdingAccountId;
    this.#visibility = details.visibility;
    this.#status = details.status;
    this.#minimumReliability = details.minimumReliability;
    this.#invitedGroupId = details.invitedGroupId;
    this.#participations = [...details.participations];
    this.#nextQueueSequence = details.nextQueueSequence;
    this.#pendingSettlement =
      details.pendingSettlement === undefined
        ? undefined
        : { batch: cloneBatch(details.pendingSettlement) };
    this.#payoutAttemptIds = new Set(
      details.payoutAttemptIds ??
        (details.pendingSettlement ? [details.pendingSettlement.payoutId] : []),
    );
    this.#payoutIdempotencyKeys = new Set(
      details.payoutIdempotencyKeys ??
        (details.pendingSettlement
          ? [details.pendingSettlement.idempotencyKey]
          : []),
    );
    validateSessionRoster({
      status: this.#status,
      visibility: this.#visibility,
      totalSlots: this.#totalSlots,
      minimumHeadcount: this.#minimumHeadcount,
      nextQueueSequence: this.#nextQueueSequence,
      participations: this.#participations,
      holdingAccountId: this.#holdingAccountId,
      pendingSettlement: this.#pendingSettlement?.batch,
      payoutAttemptIds: this.#payoutAttemptIds,
      payoutIdempotencyKeys: this.#payoutIdempotencyKeys,
      sessionId: this.#sessionId,
    });
  }

  recordAdmission(
    admission: Participation,
    refundedReplacement: Participation | undefined,
    now: Date,
  ): void {
    assertOpenBefore(this.#status, this.#booking, now);
    validateAdmission(
      this.#participations,
      admission,
      refundedReplacement,
      this.#totalSlots,
      this.#nextQueueSequence,
      now,
    );
    if (admission.hold !== undefined)
      DomainError.require(
        admission.hold.amount.equals(this.bookingShare),
        "INVALID_INPUT",
        "An admission hold must match the booking share",
      );
    const existing = this.#participations.find(
      (p) => p.userId === admission.userId,
    );
    let next =
      existing === undefined
        ? [...this.#participations, admission]
        : replaceParticipation(
            this.#participations,
            existing.participationId,
            admission,
          );
    if (refundedReplacement !== undefined)
      next = replaceParticipation(
        next,
        refundedReplacement.participationId,
        refundedReplacement,
      );
    const sequence =
      this.#nextQueueSequence + (admission.status === "WAITLISTED" ? 1 : 0);
    this.validateRoster(next, this.#status, sequence);
    this.#participations = next;
    this.#nextQueueSequence = sequence;
  }

  recordParticipationTransition(
    existing: Participation,
    replacement: Participation,
    now?: Date,
  ): void {
    assertOpen(this.#status);
    if (now !== undefined) assertOpenBefore(this.#status, this.#booking, now);
    DomainError.require(
      requireParticipation(this.#participations, existing.participationId) ===
        existing,
      "INVALID_STATE",
      "The participation is not the current owned record",
    );
    validateParticipationTransition(existing, replacement, now);
    const next = replaceParticipation(
      this.#participations,
      existing.participationId,
      replacement,
    );
    this.validateRoster(next);
    this.#participations = next;
  }

  recordCancellation(cancelled: readonly Participation[], now: Date): void {
    assertOpenBefore(this.#status, this.#booking, now);
    validateCancellation(this.#participations, cancelled, now);
    const next = [...cancelled];
    this.validateRoster(next, "CANCELLED");
    this.#participations = next;
    this.#status = "CANCELLED";
  }

  changeVisibility(visibility: Visibility, now: Date): void {
    DomainError.require(
      visibility === "PRIVATE" || visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    assertOpenBefore(this.#status, this.#booking, now);
    DomainError.require(
      this.getAvailableSlots(now) > 0,
      "CAPACITY_EXCEEDED",
      "Visibility cannot change after the session is full",
    );
    this.#visibility = visibility;
  }

  expireReplacements(now: Date): void {
    validDate(now, "now");
    if (!this.#booking.hasStarted(now)) return;
    this.#participations = expireReplacements(this.#participations, now);
  }

  recordAttendance(verified: readonly Participation[], now: Date): void {
    assertAttendanceOpen(this.#status, this.#booking, now);
    validateAttendanceChanges(this.#participations, verified, now);
    let next = [...this.#participations];
    for (const participation of verified)
      next = replaceParticipation(
        next,
        participation.participationId,
        participation,
      );
    const status = attendanceStatus(next);
    this.validateRoster(next, status);
    this.#participations = next;
    this.#status = status;
  }

  autoVerifyAttendance(now: Date): void {
    validDate(now, "now");
    DomainError.require(
      this.#status === "OPEN",
      "INVALID_STATE",
      "Automatic verification can only run on an open session",
    );
    const change = autoVerifyAttendance(
      this.#participations,
      this.#booking,
      now,
    );
    this.#participations = change.participations;
    this.#status = change.status;
  }

  recordSettlementPreparation(
    preparation: SessionSettlementPreparation,
    now: Date,
  ): void {
    requireId(preparation.payoutId, "payoutId");
    DomainError.require(
      preparation.idempotencyKey.trim() !== "",
      "INVALID_INPUT",
      "idempotencyKey is required",
    );
    assertSettlementOpen(this.#status, this.#booking, now);
    validateSettlementPreparation(
      this.#participations,
      preparation,
      this.#bookerId,
      this.#sessionId,
      now,
    );
    validatePayoutAttempt(
      this.#pendingSettlement?.batch,
      [...this.#payoutAttemptIds],
      [...this.#payoutIdempotencyKeys],
      preparation.payoutId,
      preparation.idempotencyKey,
    );
    const next = [...preparation.participations];
    const batch = preparation.batch;
    if (batch === undefined) {
      this.validateRoster(next, "SETTLED");
      this.#participations = next;
      this.#status = "SETTLED";
      return;
    }
    const pending = { batch: cloneBatch(batch) };
    const attemptIds = new Set(this.#payoutAttemptIds).add(
      preparation.payoutId,
    );
    const idempotencyKeys = new Set(this.#payoutIdempotencyKeys).add(
      preparation.idempotencyKey,
    );
    this.validateRoster(
      next,
      "PAYOUT_PENDING",
      this.#nextQueueSequence,
      pending.batch,
      attemptIds,
      idempotencyKeys,
    );
    this.#participations = next;
    this.#payoutAttemptIds = attemptIds;
    this.#payoutIdempotencyKeys = idempotencyKeys;
    this.#pendingSettlement = pending;
    this.#status = "PAYOUT_PENDING";
  }

  completeSettlement(payoutId: UUID, at: Date): FinancialResult {
    requireId(payoutId, "payoutId");
    validDate(at, "at");
    const pending = this.#pendingSettlement;
    DomainError.require(
      this.#status === "PAYOUT_PENDING" && pending !== undefined,
      "INVALID_STATE",
      "No payout is awaiting completion",
    );
    DomainError.require(
      pending.batch.payoutId === payoutId,
      "STALE_PAYOUT",
      "This payout attempt is no longer current",
    );
    const change = completeSettlement(
      this.#sessionId,
      this.#participations,
      pending.batch,
      payoutId,
      at,
    );
    this.#participations = change.participations;
    this.#pendingSettlement = undefined;
    this.#status = "SETTLED";
    return change.result;
  }

  failSettlement(payoutId: UUID, at: Date): void {
    requireId(payoutId, "payoutId");
    validDate(at, "at");
    DomainError.require(
      this.#status === "PAYOUT_PENDING" &&
        this.#pendingSettlement?.batch.payoutId === payoutId,
      "STALE_PAYOUT",
      "This payout attempt is no longer current",
    );
    this.#pendingSettlement = undefined;
    this.#status = "AWAITING_PAYOUT";
  }

  get sessionId(): UUID {
    return this.#sessionId;
  }
  get bookerId(): UUID {
    return this.#bookerId;
  }
  get booking(): Booking {
    return this.#booking;
  }
  get totalSlots(): number {
    return this.#totalSlots;
  }
  get minimumHeadcount(): number {
    return this.#minimumHeadcount;
  }
  get bookingShare(): Money {
    return this.#booking.totalCost.divideFloor(this.#totalSlots);
  }
  get visibility(): Visibility {
    return this.#visibility;
  }
  get status(): SessionStatus {
    return this.#status;
  }
  get minimumReliability(): ReliabilityScore | undefined {
    return this.#minimumReliability;
  }
  get roomToken(): string {
    return this.#roomToken;
  }
  get holdingAccountId(): UUID {
    return this.#holdingAccountId;
  }
  get invitedGroupId(): UUID | undefined {
    return this.#invitedGroupId;
  }
  get participations(): readonly Participation[] {
    return [...this.#participations];
  }

  get nextQueueSequence(): number {
    return this.#nextQueueSequence;
  }
  get payoutAttemptIds(): readonly UUID[] {
    return [...this.#payoutAttemptIds];
  }
  get payoutIdempotencyKeys(): readonly string[] {
    return [...this.#payoutIdempotencyKeys];
  }
  get nextWaitlistedUserId(): UUID | undefined {
    return nextWaitlisted(this.#participations)?.userId;
  }
  get pendingSettlement(): SettlementBatch | undefined {
    return this.#pendingSettlement === undefined
      ? undefined
      : cloneBatch(this.#pendingSettlement.batch);
  }

  getAvailableSlots(now?: Date): number {
    if (this.#status !== "OPEN") return 0;
    if (now !== undefined) {
      const at = validDate(now, "now");
      if (this.#booking.hasStarted(at)) return 0;
    }
    return availableSlots(this.#participations, this.#totalSlots);
  }

  meetsReliabilityRequirement(score: ReliabilityScore): boolean {
    return (
      this.#minimumReliability === undefined ||
      score.meetsMinimum(this.#minimumReliability)
    );
  }

  private validateRoster(
    participations: readonly Participation[],
    status: SessionStatus = this.#status,
    nextQueueSequence = this.#nextQueueSequence,
    pendingSettlement = this.#pendingSettlement?.batch,
    payoutAttemptIds: ReadonlySet<UUID> = this.#payoutAttemptIds,
    payoutIdempotencyKeys: ReadonlySet<string> = this.#payoutIdempotencyKeys,
  ): void {
    validateSessionRoster({
      status,
      visibility: this.#visibility,
      totalSlots: this.#totalSlots,
      minimumHeadcount: this.#minimumHeadcount,
      nextQueueSequence,
      participations,
      holdingAccountId: this.#holdingAccountId,
      pendingSettlement,
      payoutAttemptIds,
      payoutIdempotencyKeys,
      sessionId: this.#sessionId,
    });
  }
}
