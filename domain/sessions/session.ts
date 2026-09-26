import {
  prepareSettlementRoster,
  buildSettlementBatch,
} from "./session-settlement";
import { calculateJoin, calculatePromotion } from "./session-admission";
import { availableSlots } from "./session-roster";
import { meetsReliabilityRequirement } from "./session-admission";
import {
  leaveWaitlist,
  withdrawParticipant,
  offerReplacementToWaitlist,
  removeParticipant,
  cancelRoster,
  expireReplacements,
  verifyAttendance,
  autoVerifyAttendance,
} from "./session-roster";
import {
  requireParticipation,
  nextWaitlisted,
  replaceParticipation,
} from "./session-roster";
import {
  cloneBatch,
  requireId,
  validDate,
  validatePayoutDestination,
  validateSessionDetails,
  validateSessionRoster,
} from "./session-validation";
import type { User } from "../accounts/user";
import { Money } from "../finance/money";
import { ReliabilityScore } from "../reliability/reliability-score";
import { DomainError } from "../shared/errors";
import type {
  AdmissionResult,
  FinancialInstruction,
  FinancialResult,
  PayoutDestination,
  PromotionResult,
  SettlementBatch,
  WithdrawalResult,
} from "../shared/operations";
import type {
  AccountStatus,
  SessionStatus,
  Visibility,
} from "../shared/statuses";
import type { UUID } from "../shared/types";
import { Booking } from "./booking";
import type { Participation } from "./participation";

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

export interface SessionCreation {
  readonly sessionId: UUID;
  readonly bookerId: UUID;
  readonly bookerStatus: AccountStatus;
  readonly payoutReady: boolean;
  readonly booking: Booking;
  readonly totalSlots: number;
  readonly minimumHeadcount: number;
  readonly roomToken: string;
  readonly holdingAccountId: UUID;
  readonly now: Date;
  readonly visibility?: Visibility;
  readonly minimumReliability?: ReliabilityScore;
  readonly invitedGroupId?: UUID;
}

export interface JoinCommand {
  readonly participationId: UUID;
  readonly holdId?: UUID;
  readonly now: Date;
  readonly roomToken?: string;
  readonly replacementToken?: string;
  readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
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
 * Roster and lifecycle commands enter through this root so capacity, admission,
 * replacement, attendance, and settlement rules are checked together.
 * Payout is a separate root; financial instructions describe effects for the
 * application layer to coordinate with the ledger.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
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

  static create(details: SessionCreation): Session {
    DomainError.require(
      details.bookerStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "An inactive booker cannot create a session",
    );
    DomainError.require(
      details.payoutReady === true,
      "PAYOUT_ACCOUNT_NOT_READY",
      "A session needs a completed payout account",
    );
    const now = validDate(details.now, "now");
    const session = new Session({
      sessionId: details.sessionId,
      bookerId: details.bookerId,
      booking: details.booking,
      totalSlots: details.totalSlots,
      minimumHeadcount: details.minimumHeadcount,
      roomToken: details.roomToken,
      holdingAccountId: details.holdingAccountId,
      visibility: details.visibility ?? "PRIVATE",
      status: "OPEN",
      minimumReliability: details.minimumReliability,
      invitedGroupId: details.invitedGroupId,
      participations: [],
      nextQueueSequence: 1,
      payoutAttemptIds: [],
      payoutIdempotencyKeys: [],
    });
    DomainError.require(
      !session.#booking.hasStarted(now),
      "SESSION_STARTED",
      "A new session must be upcoming",
    );
    DomainError.require(
      session.bookingShare.toCents() > 0,
      "INVALID_INPUT",
      "The booking share must be positive",
    );
    return session;
  }

  join(user: User, command: JoinCommand): AdmissionResult {
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
      user,
      command,
    );
    this.#participations = change.participations;
    this.#nextQueueSequence = change.nextQueueSequence;
    return change.result;
  }

  promoteNext(user: User, command: PromotionCommand): PromotionResult {
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
      user,
      command,
    );
    this.#participations = change.participations;
    this.#nextQueueSequence = change.nextQueueSequence;
    return change.result;
  }

  leaveWaitlist(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now?: Date;
  }): void {
    DomainError.require(
      this.#status === "OPEN",
      "SESSION_CLOSED",
      "The session is not open",
    );
    if (command.now !== undefined) this.assertOpenBefore(command.now);
    this.#participations = leaveWaitlist(this.#participations, command);
  }

  withdrawParticipant(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now: Date;
    readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
    readonly replacementToken?: string;
  }): WithdrawalResult {
    if (command.replacementMode !== undefined)
      DomainError.require(
        command.replacementMode === "OPEN_SLOT" ||
          command.replacementMode === "INVITE_LINK",
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
    this.assertOpenBefore(command.now);
    const change = withdrawParticipant(
      this.#sessionId,
      this.#participations,
      this.#booking,
      command,
    );
    this.#participations = change.participations;
    return change.result;
  }

  offerReplacementToWaitlist(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now: Date;
  }): FinancialResult {
    this.assertOpenBefore(command.now);
    const change = offerReplacementToWaitlist(this.#participations, command);
    this.#participations = change.participations;
    return change.result;
  }

  removeParticipant(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now: Date;
  }): FinancialResult {
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    const change = removeParticipant(
      this.#sessionId,
      this.#participations,
      command,
    );
    this.#participations = change.participations;
    return change.result;
  }

  cancel(command: {
    readonly actorId: UUID;
    readonly now: Date;
  }): FinancialResult {
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    const change = cancelRoster(
      this.#sessionId,
      this.#participations,
      command.now,
    );
    this.#participations = change.participations;
    this.#status = "CANCELLED";
    return change.result;
  }

  changeVisibility(command: {
    readonly actorId: UUID;
    readonly visibility: Visibility;
    readonly now: Date;
  }): void {
    DomainError.require(
      command.visibility === "PRIVATE" || command.visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    DomainError.require(
      this.getAvailableSlots(command.now) > 0,
      "CAPACITY_EXCEEDED",
      "Visibility cannot change after the session is full",
    );
    this.#visibility = command.visibility;
  }

  expireReplacements(now: Date): void {
    validDate(now, "now");
    if (!this.#booking.hasStarted(now)) return;
    this.#participations = expireReplacements(this.#participations, now);
  }

  verifyAttendance(command: {
    readonly actorId: UUID;
    readonly marks: readonly {
      readonly participationId: UUID;
      readonly attendance: "ATTENDED" | "ABSENT";
    }[];
    readonly now: Date;
  }): void {
    validDate(command.now, "now");
    this.assertBooker(command.actorId);
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
    const change = verifyAttendance(this.#participations, command);
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

  prepareSettlement(command: {
    readonly actorId: UUID;
    readonly payoutId: UUID;
    readonly idempotencyKey: string;
    readonly destination: PayoutDestination;
    readonly now: Date;
  }): SettlementBatch | undefined {
    requireId(command.payoutId, "payoutId");
    DomainError.require(
      command.idempotencyKey.trim() !== "",
      "INVALID_INPUT",
      "idempotencyKey is required",
    );
    validatePayoutDestination(command.destination);
    this.assertBooker(command.actorId);
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
      command.destination,
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
    const batch = buildSettlementBatch(this.#sessionId, next, command);
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
    const instructions: FinancialInstruction[] = [];
    let next = this.#participations;
    for (const line of pending.batch.lines) {
      const participation = requireParticipation(
        this.#participations,
        line.participationId,
      );
      DomainError.require(
        participation.hold?.holdId === line.holdId,
        "INVALID_STATE",
        "Settlement hold no longer matches the batch",
      );
      const updated = participation.settleHold(line.kind, payoutId, at);
      next = replaceParticipation(next, participation.participationId, updated);
      instructions.push({
        kind: line.kind,
        sessionId: this.#sessionId,
        participationId: line.participationId,
        holdId: line.holdId,
        holdingAccountId: line.holdingAccountId,
        walletId: line.walletId,
        amount: line.amount,
        occurredAt: validDate(at, "at"),
        payoutId,
      });
    }
    this.#participations = next;
    this.#pendingSettlement = undefined;
    this.#status = "SETTLED";
    return { instructions };
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

  private assertBooker(actorId: UUID): void {
    DomainError.require(
      actorId === this.#bookerId,
      "UNAUTHORIZED",
      "Only the booker may perform this action",
    );
  }
}
