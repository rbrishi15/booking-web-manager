import type { Money } from "../../finance/money";
import type { ReliabilityScore } from "../../reliability/reliability-score";
import { DomainError } from "../../shared/errors";
import type { FinancialResult, PayoutBatch } from "../../shared/operations";
import type { SessionStatus, Visibility } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import { resolveBookingShare, restoreBookingShare } from "../pricing";
import { isValidSlotCount } from "../capacity";
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
import { validatePayoutBatchPreparation } from "./session-recording";
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
  /** Omission preserves the equal-split default for existing domain callers. */
  readonly bookingShare?: Money;
  readonly totalSlots: number;
  readonly visibility: Visibility;
  readonly status: SessionStatus;
  readonly minimumReliability?: ReliabilityScore;
  readonly roomToken: string;
  readonly holdingAccountId: UUID;
  readonly participations: readonly Participation[];
  readonly nextQueueSequence: number;
  readonly pendingSettlement?: PayoutBatch;
  readonly payoutAttemptIds: readonly UUID[];
}

export interface SessionEditDetails {
  readonly booking: Booking;
  readonly bookingShare: Money;
  readonly totalSlots: number;
  readonly visibility: Visibility;
}

/** Prepared settlement values recorded together; this is not an actor command. */
export interface SessionSettlementPreparation {
  readonly payoutId: UUID;
  readonly participations: readonly Participation[];
  readonly batch?: PayoutBatch;
}

interface PayoutPending {
  readonly batch: PayoutBatch;
}

interface PreparedSessionState {
  readonly status: SessionStatus;
  readonly pendingSettlement?: PayoutBatch;
  readonly payoutAttemptIds?: ReadonlySet<UUID>;
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
  readonly #bookingShare: Money;
  readonly #totalSlots: number;
  readonly #roomToken: string;
  readonly #holdingAccountId: UUID;
  readonly #minimumReliability?: ReliabilityScore;
  #visibility: Visibility;
  #status: SessionStatus;
  #invitedGroupId?: UUID;
  #participantList: ParticipantList;
  #pendingSettlement?: PayoutPending;
  #payoutAttemptIds: Set<UUID>;

  constructor(details: SessionDetails) {
    validateSessionDetails(details);

    this.#sessionId = details.sessionId;
    this.#bookerId = details.bookerId;
    this.#booking = details.booking;
    this.#totalSlots = details.totalSlots;
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
    this.#payoutAttemptIds = new Set(details.payoutAttemptIds);
    validateSessionConfiguration({
      status: this.#status,
      visibility: this.#visibility,
      totalSlots: this.#totalSlots,
    });
    this.#bookingShare = details.bookingShare === undefined
      ? resolveBookingShare(this.#booking.totalCost, this.#totalSlots)
      : restoreBookingShare(details.bookingShare, this.#totalSlots);
    // Historical paid booker records already occupy the booker’s place.
    const bookerHasFundedPlace = details.participations.some(
      (p) => p.userId === details.bookerId && p.status === "COMMITTED",
    );
    this.#participantList = new ParticipantList(
      {
        participations: details.participations,
        nextQueueSequence: details.nextQueueSequence,
      },
      {
        totalSlots: this.#totalSlots - (bookerHasFundedPlace ? 0 : 1),
        holdingAccountId: this.#holdingAccountId,
      },
    );
    this.validateState(this.#participantList);
  }

  recordAdmission(
    admission: Participation,
    completedReplacement: Participation | undefined,
    now: Date,
  ): void {
    assertOpenBefore(this.#status, this.#booking, now);
    DomainError.require(admission.userId !== this.#bookerId, "ALREADY_PARTICIPATING", "The booker already has a place in this session");
    const next = this.#participantList.withAdmission(
      admission,
      completedReplacement,
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
    DomainError.require(existing.userId !== this.#bookerId || existing.status !== "COMMITTED",
      "INVALID_STATE", "The booker must cancel the session to leave their place");
    DomainError.require(replacement.replacementInviteeId !== this.#bookerId,
      "INVALID_STATE", "The booker already has a place in this session");
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

  /** Validates a complete candidate before any editable state is persisted. */
  editDetails(details: SessionEditDetails, now: Date): Session {
    assertOpenBefore(this.#status, this.#booking, now);
    DomainError.require(isValidSlotCount(details.totalSlots) || details.totalSlots === this.#totalSlots,
      "INVALID_INPUT", "Capacity must be between 1 and 30 players");
    DomainError.require(details.totalSlots >= this.#totalSlots - this.getAvailableSlots(now),
      "CAPACITY_EXCEEDED", "Capacity cannot be lower than occupied or reserved places");
    const termsChanged = !details.booking.equals(this.#booking) || !details.bookingShare.equals(this.#bookingShare);
    DomainError.require(!termsChanged || !this.bookingDetailsLocked,
      "SESSION_DETAILS_LOCKED", "Booking details and price are locked after a player has joined. Reload the session to continue.");
    DomainError.require(!details.booking.hasStarted(now), "SESSION_STARTED", "The session must start in the future");
    // Capacity changes retain the accepted price. Changed cost/price uses creation bounds.
    if (!details.booking.totalCost.equals(this.#booking.totalCost) || !details.bookingShare.equals(this.#bookingShare))
      resolveBookingShare(details.booking.totalCost, details.totalSlots, details.bookingShare);
    const next = new Session({
      sessionId: this.#sessionId, bookerId: this.#bookerId, booking: details.booking,
      bookingShare: details.bookingShare, totalSlots: details.totalSlots, visibility: this.#visibility,
      status: this.#status, minimumReliability: this.#minimumReliability, roomToken: this.#roomToken,
      holdingAccountId: this.#holdingAccountId, invitedGroupId: this.#invitedGroupId,
      participations: this.#participantList.participations, nextQueueSequence: this.#participantList.nextQueueSequence,
      pendingSettlement: this.pendingSettlement, payoutAttemptIds: this.payoutAttemptIds,
    });
    if (details.visibility !== this.#visibility) next.changeVisibility(details.visibility, now);
    return next;
  }

  get bookingDetailsLocked(): boolean {
    // History continues to lock terms after withdrawal, including legacy funded bookers.
    return this.#participantList.participations.length > 0;
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
    assertSettlementOpen(this.#status, this.#booking, now);
    const next = this.#participantList.withSettlementPreparation(
      preparation.participations,
    );
    validatePayoutBatchPreparation(
      next.participations,
      preparation,
      this.#bookerId,
      this.#sessionId,
      now,
    );
    validatePayoutAttempt(
      this.#pendingSettlement?.batch,
      [...this.#payoutAttemptIds],
      preparation.payoutId,
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
    this.validateState(next, {
      status: "PAYOUT_PENDING",
      pendingSettlement: pending.batch,
      payoutAttemptIds: attemptIds,
    });
    this.#participantList = next;
    this.#payoutAttemptIds = attemptIds;
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
  get bookingShare(): Money {
    return this.#bookingShare;
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
  get pendingSettlement(): PayoutBatch | undefined {
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
    const bookerHasFundedPlace =
      this.#participantList.findByUserId(this.#bookerId)?.status === "COMMITTED";
    return Math.max(
      0,
      this.#totalSlots - (bookerHasFundedPlace ? 0 : 1) -
        this.#participantList.committedCount -
        this.#participantList.reservedCount -
        this.#participantList.forfeitedCount,
    );
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
      sessionId: this.#sessionId,
    });
  }
}
