import type { Money } from "../../finance/money";
import type { ReliabilityScore } from "../../reliability/reliability-score";
import { DomainError } from "../../shared/errors";
import type { FinancialResult, SettlementBatch } from "../../shared/operations";
import type { SessionStatus, Visibility } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import type { Participation } from "../participation";
import { ParticipantList, type ParticipantListView } from "./participant-list";
import { completeSettlement } from "./session-settlement";
import {
  assertAttendanceOpen,
  assertOpen,
  assertOpenBefore,
  assertSettlementOpen,
  validatePayoutAttempt,
} from "./session-guards";
import { validateSettlementBatchPreparation } from "./session-recording";
import {
  cloneBatch,
  requireId,
  validDate,
  validateSessionDetails,
  validateSessionConfiguration,
  validateSessionState,
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

interface PreparedSessionState {
  readonly status: SessionStatus;
  readonly pendingSettlement?: SettlementBatch;
  readonly payoutAttemptIds?: ReadonlySet<UUID>;
  readonly payoutIdempotencyKeys?: ReadonlySet<string>;
}

/**
 * Aggregate root: Session.
 * Owns Booking, ParticipantList and its Participation/FundHold children,
 * attendance, and settlement history. Roles authorize and run user workflows;
 * these bounded recording operations validate and atomically install their
 * prepared children. They never invoke roles or reconstruct financial results.
 * System attendance, replacement expiry, and payout callbacks remain here.
 * See ADR-0003, ADR-0009, and ADR-0010. Persistence/ledger atomicity belongs to use cases.
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
  #participantList: ParticipantList;
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
    validateSessionConfiguration({
      status: this.#status,
      visibility: this.#visibility,
      totalSlots: this.#totalSlots,
      minimumHeadcount: this.#minimumHeadcount,
    });
    this.#participantList = new ParticipantList(
      {
        participations: details.participations,
        nextQueueSequence: details.nextQueueSequence,
      },
      {
        totalSlots: this.#totalSlots,
        holdingAccountId: this.#holdingAccountId,
      },
    );
    this.validateState(this.#participantList);
  }

  recordAdmission(
    admission: Participation,
    refundedReplacement: Participation | undefined,
    now: Date,
  ): void {
    assertOpenBefore(this.#status, this.#booking, now);
    const next = this.#participantList.withAdmission(
      admission,
      refundedReplacement,
      now,
      this.bookingShare,
    );
    this.validateState(next);
    this.#participantList = next;
  }

  recordParticipationTransition(
    existing: Participation,
    replacement: Participation,
    now?: Date,
  ): void {
    assertOpen(this.#status);
    if (now !== undefined) assertOpenBefore(this.#status, this.#booking, now);
    const next = this.#participantList.withParticipationTransition(
      existing,
      replacement,
      now,
    );
    this.validateState(next);
    this.#participantList = next;
  }

  recordCancellation(cancelled: readonly Participation[], now: Date): void {
    assertOpenBefore(this.#status, this.#booking, now);
    const next = this.#participantList.withCancellation(cancelled, now);
    this.validateState(next, { status: "CANCELLED" });
    this.#participantList = next;
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
    const next = this.#participantList.withExpiredReplacements(now);
    this.validateState(next);
    this.#participantList = next;
  }

  recordAttendance(verified: readonly Participation[], now: Date): void {
    assertAttendanceOpen(this.#status, this.#booking, now);
    const next = this.#participantList.withAttendance(verified, now);
    const status = next.hasCompleteAttendance ? "AWAITING_PAYOUT" : "OPEN";
    this.validateState(next, { status });
    this.#participantList = next;
    this.#status = status;
  }

  autoVerifyAttendance(now: Date): void {
    validDate(now, "now");
    DomainError.require(
      this.#status === "OPEN",
      "INVALID_STATE",
      "Automatic verification can only run on an open session",
    );
    DomainError.require(
      now.getTime() >= this.#booking.endAt.getTime() + 72 * 3_600_000,
      "AUTO_VERIFICATION_NOT_DUE",
      "Automatic verification is not due",
    );
    const next = this.#participantList.withAutomaticAttendance(now);
    const status = next.hasCompleteAttendance ? "AWAITING_PAYOUT" : "OPEN";
    this.validateState(next, { status });
    this.#participantList = next;
    this.#status = status;
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
    const next = this.#participantList.withSettlementPreparation(
      preparation.participations,
    );
    validateSettlementBatchPreparation(
      next.participations,
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
    const batch = preparation.batch;
    if (batch === undefined) {
      this.validateState(next, { status: "SETTLED" });
      this.#participantList = next;
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
    this.validateState(next, {
      status: "PAYOUT_PENDING",
      pendingSettlement: pending.batch,
      payoutAttemptIds: attemptIds,
      payoutIdempotencyKeys: idempotencyKeys,
    });
    this.#participantList = next;
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
      this.#participantList,
      pending.batch,
      payoutId,
      at,
    );
    this.validateState(change.participantList, { status: "SETTLED" });
    this.#participantList = change.participantList;
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
  get participantList(): ParticipantListView {
    return this.#participantList;
  }

  get payoutAttemptIds(): readonly UUID[] {
    return [...this.#payoutAttemptIds];
  }
  get payoutIdempotencyKeys(): readonly string[] {
    return [...this.#payoutIdempotencyKeys];
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
    return Math.max(0, this.#totalSlots - this.#participantList.committedCount);
  }

  meetsReliabilityRequirement(score: ReliabilityScore): boolean {
    return (
      this.#minimumReliability === undefined ||
      score.meetsMinimum(this.#minimumReliability)
    );
  }

  private validateState(
    participantList: ParticipantListView,
    state: PreparedSessionState = {
      status: this.#status,
      pendingSettlement: this.#pendingSettlement?.batch,
    },
  ): void {
    validateSessionState({
      status: state.status,
      participantList,
      pendingSettlement: state.pendingSettlement,
      payoutAttemptIds: state.payoutAttemptIds ?? this.#payoutAttemptIds,
      payoutIdempotencyKeys:
        state.payoutIdempotencyKeys ?? this.#payoutIdempotencyKeys,
      sessionId: this.#sessionId,
    });
  }
}
