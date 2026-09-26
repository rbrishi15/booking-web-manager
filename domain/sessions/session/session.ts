import type {
  Booker,
  SettlementCommand,
  VerifyAttendanceCommand,
} from "../../accounts/booker";
import type {
  LeaveWaitlistCommand,
  Participant,
  ParticipantJoinCommand,
  ParticipantReplacementOfferCommand,
  ParticipantWithdrawalCommand,
} from "../../accounts/participant";
import type { Money } from "../../finance/money";
import type { ReliabilityScore } from "../../reliability/reliability-score";
import { DomainError } from "../../shared/errors";
import type {
  AdmissionResult,
  FinancialResult,
  PromotionResult,
  SettlementBatch,
  WithdrawalResult,
} from "../../shared/operations";
import type { SessionStatus, Visibility } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import type { Participation } from "../participation";
import {
  calculateJoin,
  calculatePromotion,
  meetsReliabilityRequirement,
} from "./session-admission";
import {
  autoVerifyAttendance,
  availableSlots,
  cancelRoster,
  expireReplacements,
  nextWaitlisted,
  replaceParticipation,
  requireParticipation,
  verifyAttendance,
} from "./session-roster";
import {
  buildSettlementBatch,
  completeSettlement,
  prepareSettlementRoster,
} from "./session-settlement";
import {
  cloneBatch,
  requireId,
  validDate,
  validatePayoutDestination,
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

export interface PromotionCommand {
  readonly holdId: UUID;
  readonly now: Date;
}

interface PayoutPending {
  readonly batch: SettlementBatch;
}

/**
 * Aggregate root: Session.
 * Owns Booking, Participation children and their FundHold children, queue order,
 * attendance, and session settlement state, including payout-attempt history.
 * Participant owns eligibility, funding, and voluntary departure decisions.
 * Guarded roster operations retain lifecycle, access, capacity, queue order,
 * cross-participant replacement refunds, and atomic installation of changes.
 * Booker owns creation, owner authorization, and individual administrative
 * transitions. This root guards and atomically installs their combined results.
 * Automated attendance and the settlement lifecycle remain root operations.
 * Payout is a separate root; financial instructions describe effects for the
 * application layer to coordinate with the ledger.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md, ADR-0007, and ADR-0008.
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

  admitParticipant(
    participant: Participant,
    command: ParticipantJoinCommand,
  ): AdmissionResult {
    requireId(command.participationId, "participationId");
    if (command.holdId !== undefined) requireId(command.holdId, "holdId");
    this.assertOpenBefore(command.now);
    const change = calculateJoin(
      {
        sessionId: this.#sessionId,
        holdingAccountId: this.#holdingAccountId,
        participations: this.#participations,
        nextQueueSequence: this.#nextQueueSequence,
        totalSlots: this.#totalSlots,
        totalCost: this.#booking.totalCost,
        minimumReliability: this.#minimumReliability,
        visibility: this.#visibility,
        roomToken: this.#roomToken,
        invitedGroupId: this.#invitedGroupId,
      },
      participant,
      command,
    );
    this.#participations = change.participations;
    this.#nextQueueSequence = change.nextQueueSequence;
    return change.result;
  }

  promoteNext(
    participant: Participant,
    command: PromotionCommand,
  ): PromotionResult {
    this.assertOpenBefore(command.now);
    const change = calculatePromotion(
      {
        sessionId: this.#sessionId,
        holdingAccountId: this.#holdingAccountId,
        participations: this.#participations,
        nextQueueSequence: this.#nextQueueSequence,
        totalSlots: this.#totalSlots,
        totalCost: this.#booking.totalCost,
        minimumReliability: this.#minimumReliability,
      },
      participant,
      command,
    );
    this.#participations = change.participations;
    this.#nextQueueSequence = change.nextQueueSequence;
    return change.result;
  }

  removeWaitlistedParticipant(
    participant: Participant,
    command: LeaveWaitlistCommand,
  ): void {
    DomainError.require(
      this.#status === "OPEN",
      "SESSION_CLOSED",
      "The session is not open",
    );
    if (command.now !== undefined) this.assertOpenBefore(command.now);
    const existing = requireParticipation(
      this.#participations,
      command.participationId,
    );
    const departed = participant.prepareWaitlistDeparture(existing);
    this.#participations = replaceParticipation(
      this.#participations,
      existing.participationId,
      departed,
    );
  }

  applyParticipantWithdrawal(
    participant: Participant,
    command: ParticipantWithdrawalCommand,
  ): WithdrawalResult {
    participant.validateWithdrawal(command);
    this.assertOpenBefore(command.now);
    const existing = requireParticipation(
      this.#participations,
      command.participationId,
    );
    const change = participant.prepareWithdrawal(
      existing,
      this.#booking,
      command,
      this.#sessionId,
    );
    this.#participations = replaceParticipation(
      this.#participations,
      existing.participationId,
      change.participation,
    );
    return change.result;
  }

  releaseParticipantReplacement(
    participant: Participant,
    command: ParticipantReplacementOfferCommand,
  ): FinancialResult {
    this.assertOpenBefore(command.now);
    const existing = requireParticipation(
      this.#participations,
      command.participationId,
    );
    const change = participant.prepareReplacementOffer(existing);
    this.#participations = replaceParticipation(
      this.#participations,
      existing.participationId,
      change.participation,
    );
    return change.result;
  }

  applyBookerRemoval(
    booker: Booker,
    participationId: UUID,
    now: Date,
  ): FinancialResult {
    booker.assertOwnsSession(this.#bookerId);
    this.assertOpenBefore(now);
    const existing = requireParticipation(
      this.#participations,
      participationId,
    );
    const change = booker.prepareRemoval(existing, this.#sessionId, now);
    this.#participations = replaceParticipation(
      this.#participations,
      existing.participationId,
      change.participation,
    );
    return change.result;
  }

  applyBookerCancellation(booker: Booker, now: Date): FinancialResult {
    booker.assertOwnsSession(this.#bookerId);
    this.assertOpenBefore(now);
    const change = cancelRoster(
      booker,
      this.#sessionId,
      this.#participations,
      now,
    );
    this.#participations = change.participations;
    this.#status = "CANCELLED";
    return change.result;
  }

  applyBookerVisibilityChange(
    booker: Booker,
    visibility: Visibility,
    now: Date,
  ): void {
    DomainError.require(
      visibility === "PRIVATE" || visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    booker.assertOwnsSession(this.#bookerId);
    this.assertOpenBefore(now);
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

  applyBookerAttendance(
    booker: Booker,
    command: VerifyAttendanceCommand,
  ): void {
    validDate(command.now, "now");
    booker.assertOwnsSession(this.#bookerId);
    DomainError.require(
      this.#status === "OPEN",
      "INVALID_STATE",
      "Attendance can only be verified on an open session",
    );
    DomainError.require(
      this.#booking.hasEnded(command.now),
      "SESSION_NOT_ENDED",
      "Attendance verification requires the session to end",
    );
    const change = verifyAttendance(this.#participations, booker, command);
    this.#participations = change.participations;
    this.#status = change.status;
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

  prepareBookerSettlement(
    booker: Booker,
    command: SettlementCommand,
  ): SettlementBatch | undefined {
    const destination = booker.payoutDestination();
    requireId(command.payoutId, "payoutId");
    DomainError.require(
      command.idempotencyKey.trim() !== "",
      "INVALID_INPUT",
      "idempotencyKey is required",
    );
    validatePayoutDestination(destination);
    booker.assertOwnsSession(this.#bookerId);
    validDate(command.now, "now");
    DomainError.require(
      this.#status !== "PAYOUT_PENDING",
      "PAYOUT_IN_PROGRESS",
      "A payout is already pending",
    );
    DomainError.require(
      this.#status === "OPEN" || this.#status === "AWAITING_PAYOUT",
      "SESSION_CLOSED",
      "Only an unsettled session can be paid out",
    );
    DomainError.require(
      this.#booking.hasEnded(command.now),
      "SESSION_NOT_ENDED",
      "Settlement requires the session to end",
    );
    const next = prepareSettlementRoster(
      this.#participations,
      this.#bookerId,
      destination,
      command.now,
    );
    DomainError.require(
      this.#pendingSettlement === undefined,
      "PAYOUT_IN_PROGRESS",
      "A payout is already pending",
    );
    DomainError.require(
      !this.#payoutAttemptIds.has(command.payoutId),
      "DUPLICATE_ID",
      "A payout ID can only be used once for this session",
    );
    DomainError.require(
      !this.#payoutIdempotencyKeys.has(command.idempotencyKey),
      "DUPLICATE_ID",
      "A payout idempotency key can only be used once for this session",
    );
    const batch = buildSettlementBatch(
      this.#sessionId,
      next,
      command,
      destination,
    );
    if (batch === undefined) {
      this.#participations = next;
      this.#status = "SETTLED";
      return undefined;
    }
    const pending = { batch: cloneBatch(batch) };
    const result = cloneBatch(batch);
    const attemptIds = new Set(this.#payoutAttemptIds).add(command.payoutId);
    const idempotencyKeys = new Set(this.#payoutIdempotencyKeys).add(
      command.idempotencyKey,
    );
    this.#participations = next;
    this.#payoutAttemptIds = attemptIds;
    this.#payoutIdempotencyKeys = idempotencyKeys;
    this.#pendingSettlement = pending;
    this.#status = "PAYOUT_PENDING";
    return result;
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
    return meetsReliabilityRequirement(score, this.#minimumReliability);
  }

  private assertOpenBefore(at: Date): void {
    validDate(at, "now");
    DomainError.require(
      this.#status === "OPEN",
      "SESSION_CLOSED",
      "The session is not open",
    );
    DomainError.require(
      !this.#booking.hasStarted(at),
      "SESSION_STARTED",
      "The session has started",
    );
  }
}
