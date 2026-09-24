import type { User } from "../accounts/user";
import { Money } from "../finance/money";
import { ReliabilityScore } from "../reliability/reliability-score";
import { DomainError, requireDomain } from "../shared/errors";
import type {
  AdmissionResult,
  FinancialInstruction,
  FinancialResult,
  PayoutDestination,
  PromotionResult,
  SettlementBatch,
  SettlementLine,
  WithdrawalResult,
} from "../shared/operations";
import type {
  AccountStatus,
  SessionStatus,
  Visibility,
} from "../shared/statuses";
import type { UUID } from "../shared/types";
import { Booking } from "./booking";
import { FundHold } from "./fund-hold";
import { Participation } from "./participation";

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
    requireDomain(
      details.booking instanceof Booking,
      "INVALID_INPUT",
      "A session needs a Booking value object",
    );
    requireId(details.sessionId, "sessionId");
    requireId(details.bookerId, "bookerId");
    requireId(details.holdingAccountId, "holdingAccountId");
    requireDomain(
      typeof details.roomToken === "string" && details.roomToken.trim() !== "",
      "INVALID_INPUT",
      "A session needs a room token",
    );
    requireDomain(
      Array.isArray(details.participations),
      "INVALID_INPUT",
      "A session needs a participation roster",
    );
    requireDomain(
      details.participations.every((p) => p instanceof Participation),
      "INVALID_INPUT",
      "A roster needs Participation values",
    );
    const participations = details.participations;
    if (details.minimumReliability !== undefined)
      requireDomain(
        details.minimumReliability instanceof ReliabilityScore,
        "INVALID_INPUT",
        "minimumReliability must be a ReliabilityScore",
      );
    if (details.invitedGroupId !== undefined)
      requireId(details.invitedGroupId, "invitedGroupId");
    if (details.pendingSettlement !== undefined)
      validateSettlementBatch(details.pendingSettlement);
    if (details.payoutAttemptIds !== undefined)
      requireDomain(
        Array.isArray(details.payoutAttemptIds) &&
          new Set(details.payoutAttemptIds).size ===
            details.payoutAttemptIds.length,
        "DUPLICATE_ID",
        "Payout attempt IDs must be unique",
      );
    if (details.payoutIdempotencyKeys !== undefined)
      requireDomain(
        Array.isArray(details.payoutIdempotencyKeys) &&
          new Set(details.payoutIdempotencyKeys).size ===
            details.payoutIdempotencyKeys.length,
        "DUPLICATE_ID",
        "Payout idempotency keys must be unique",
      );
    const maxSequence = participations.reduce(
      (max, p) => Math.max(max, p.queueSequence ?? 0),
      0,
    );
    requireDomain(
      details.nextQueueSequence > maxSequence,
      "INVALID_INPUT",
      "Queue sequence must be ahead of the roster",
    );

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
    this.validateRoster();
  }

  static create(details: SessionCreation): Session {
    requireDomain(
      details.bookerStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "An inactive booker cannot create a session",
    );
    requireDomain(
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
    requireDomain(
      !session.#booking.hasStarted(now),
      "SESSION_STARTED",
      "A new session must be upcoming",
    );
    requireDomain(
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
    this.assertAccess(user, command.roomToken, command.replacementToken);
    this.assertEligible(user, false);
    const existing = this.#participations.find((p) => p.userId === user.userId);
    if (existing !== undefined && existing.status !== "LEFT_WAITLIST") {
      throw new DomainError(
        existing.status === "WITHDRAWN" || existing.status === "REMOVED"
          ? "REJOIN_NOT_ALLOWED"
          : "ALREADY_PARTICIPATING",
        "This user already has a participation",
      );
    }
    if (
      existing !== undefined &&
      command.participationId !== existing.participationId
    ) {
      throw new DomainError(
        "DUPLICATE_ID",
        "Waitlist re-entry must reuse the existing participation ID",
      );
    }

    if (
      this.getAvailableSlots(command.now) === 0 ||
      this.nextWaitlistedUserId !== undefined
    ) {
      const sequence = this.#nextQueueSequence;
      requireDomain(
        Number.isSafeInteger(sequence) &&
          sequence > 0 &&
          sequence < Number.MAX_SAFE_INTEGER,
        "INVALID_INPUT",
        "Queue sequence overflowed",
      );
      const queued = Participation.createWaitlisted({
        participationId: existing?.participationId ?? command.participationId,
        userId: user.userId,
        waitlistedAt: command.now,
        queueSequence: sequence,
      });
      this.#nextQueueSequence = sequence + 1;
      this.#participations =
        existing === undefined
          ? [...this.#participations, queued]
          : this.replace(existing.participationId, queued);
      return {
        kind: "WAITLISTED",
        participationId: queued.participationId,
        instructions: [],
      };
    }
    this.assertEligible(user, true);
    return this.commitNew(user, command, existing);
  }

  promoteNext(user: User, command: PromotionCommand): PromotionResult {
    this.assertOpenBefore(command.now);
    const next = this.nextWaitlisted();
    if (next === undefined) return { kind: "NONE", instructions: [] };
    requireId(command.holdId, "holdId");
    requireDomain(
      this.getAvailableSlots(command.now) > 0,
      "CAPACITY_EXCEEDED",
      "There is no available slot to promote",
    );
    requireDomain(
      next.userId === user.userId,
      "INVALID_INPUT",
      "Promotion input belongs to another user",
    );
    const reason = this.ineligibilityReason(user);
    if (reason !== undefined) {
      this.#participations = this.replace(
        next.participationId,
        next.leaveWaitlist(),
      );
      return {
        kind: "SKIPPED",
        participationId: next.participationId,
        reason,
        instructions: [],
      };
    }
    const replacement = this.oldestAwaiting();
    const committed = next.commit(
      this.newHold(next.participationId, command.holdId, user, command.now),
      command.now,
      replacement?.participationId,
    );
    this.#participations = this.replace(next.participationId, committed);
    const refund = this.refundOldestAwaiting(command.now);
    return {
      kind: "PROMOTED",
      participationId: committed.participationId,
      refundedParticipationId: refund.participationId,
      instructions: [
        this.lockInstruction(committed, command.now),
        ...(refund.instruction === undefined ? [] : [refund.instruction]),
      ],
    };
  }

  leaveWaitlist(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now?: Date;
  }): void {
    requireDomain(
      this.#status === "OPEN",
      "SESSION_CLOSED",
      "The session is not open",
    );
    if (command.now !== undefined) this.assertOpenBefore(command.now);
    const participation = this.requireParticipation(command.participationId);
    requireDomain(
      participation.userId === command.actorId,
      "UNAUTHORIZED",
      "Only the participant can leave the waitlist",
    );
    this.#participations = this.replace(
      participation.participationId,
      participation.leaveWaitlist(),
    );
  }

  withdrawParticipant(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now: Date;
    readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
    readonly replacementToken?: string;
  }): WithdrawalResult {
    if (command.replacementMode !== undefined)
      requireDomain(
        command.replacementMode === "OPEN_SLOT" ||
          command.replacementMode === "INVITE_LINK",
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
    this.assertOpenBefore(command.now);
    const participation = this.requireParticipation(command.participationId);
    requireDomain(
      participation.userId === command.actorId,
      "UNAUTHORIZED",
      "Only the participant can withdraw",
    );
    requireDomain(
      participation.status === "COMMITTED" && participation.hold !== undefined,
      "INVALID_STATE",
      "Only a committed participant can withdraw",
    );
    const hold = participation.hold;
    const late = this.#booking.hoursUntilStart(command.now) <= 30;
    const nextHold = late ? hold.awaitReplacement() : hold.refund(command.now);
    const next = participation.withdraw(
      nextHold,
      command.now,
      late ? (command.replacementMode ?? "OPEN_SLOT") : undefined,
      late ? command.replacementToken : undefined,
    );
    this.#participations = this.replace(participation.participationId, next);
    return {
      kind: late ? "AWAITING_REPLACEMENT" : "REFUNDED",
      participationId: participation.participationId,
      instructions: late ? [] : [this.refundInstruction(next, command.now)],
    };
  }

  removeParticipant(command: {
    readonly actorId: UUID;
    readonly participationId: UUID;
    readonly now: Date;
  }): FinancialResult {
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    const participation = this.requireParticipation(command.participationId);
    requireDomain(
      participation.status === "COMMITTED" && participation.hold !== undefined,
      "INVALID_STATE",
      "Only a committed participant can be removed",
    );
    const nextHold = participation.hold.refund(command.now);
    const next = participation.remove(nextHold);
    this.#participations = this.replace(participation.participationId, next);
    return { instructions: [this.refundInstruction(next, command.now)] };
  }

  cancel(command: {
    readonly actorId: UUID;
    readonly now: Date;
  }): FinancialResult {
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    const instructions: FinancialInstruction[] = [];
    let next = this.#participations;
    for (const participation of this.#participations) {
      let changed: Participation;
      if (
        participation.hold !== undefined &&
        !["REFUNDED", "RELEASED", "FORFEITED"].includes(
          participation.hold.state,
        )
      ) {
        const refundedHold = participation.hold.refund(command.now);
        changed = participation.cancel(refundedHold);
        instructions.push(this.refundInstruction(changed, command.now));
      } else {
        changed = participation.cancel();
      }
      next = this.replaceIn(next, participation.participationId, changed);
    }
    this.#participations = next;
    this.#status = "CANCELLED";
    return { instructions };
  }

  changeVisibility(command: {
    readonly actorId: UUID;
    readonly visibility: Visibility;
    readonly now: Date;
  }): void {
    requireDomain(
      command.visibility === "PRIVATE" || command.visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    this.assertBooker(command.actorId);
    this.assertOpenBefore(command.now);
    requireDomain(
      this.getAvailableSlots(command.now) > 0,
      "CAPACITY_EXCEEDED",
      "Visibility cannot change after the session is full",
    );
    this.#visibility = command.visibility;
  }

  expireReplacements(now: Date): void {
    validDate(now, "now");
    if (!this.#booking.hasStarted(now)) return;
    this.#participations = this.#participations.map((participation) =>
      participation.expireReplacement(now),
    );
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
    requireDomain(
      this.#status === "OPEN",
      "INVALID_STATE",
      "Attendance can only be verified on an open session",
    );
    requireDomain(
      this.#booking.hasEnded(command.now),
      "SESSION_NOT_ENDED",
      "Attendance verification requires the session to end",
    );
    const markedIds = new Set<UUID>();
    let next = this.#participations;
    for (const mark of command.marks) {
      requireDomain(
        !markedIds.has(mark.participationId),
        "DUPLICATE_ID",
        "A participation may be verified only once per command",
      );
      markedIds.add(mark.participationId);
      const participation = this.requireParticipation(mark.participationId);
      const verified = participation.verify(
        mark.attendance,
        "BOOKER",
        command.now,
      );
      next = this.replaceIn(next, participation.participationId, verified);
    }
    this.#participations = next;
    this.markAwaitingPayoutIfComplete();
  }

  autoVerifyAttendance(now: Date): void {
    validDate(now, "now");
    requireDomain(
      this.#status === "OPEN",
      "INVALID_STATE",
      "Automatic verification can only run on an open session",
    );
    const end = this.#booking.endAt.getTime();
    requireDomain(
      validDate(now, "now").getTime() >= end + 72 * 3_600_000,
      "AUTO_VERIFICATION_NOT_DUE",
      "Automatic verification is not due",
    );
    this.#participations = this.#participations.map((participation) =>
      participation.status === "COMMITTED" &&
      participation.attendance === "UNVERIFIED"
        ? participation.verify("ATTENDED", "AUTOMATIC", now)
        : participation,
    );
    this.markAwaitingPayoutIfComplete();
  }

  prepareSettlement(command: {
    readonly actorId: UUID;
    readonly payoutId: UUID;
    readonly idempotencyKey: string;
    readonly destination: PayoutDestination;
    readonly now: Date;
  }): SettlementBatch | undefined {
    requireId(command.payoutId, "payoutId");
    requireDomain(
      typeof command.idempotencyKey === "string" &&
        command.idempotencyKey.trim() !== "",
      "INVALID_INPUT",
      "idempotencyKey is required",
    );
    validatePayoutDestination(command.destination);
    this.assertBooker(command.actorId);
    validDate(command.now, "now");
    requireDomain(
      this.#status !== "PAYOUT_PENDING",
      "PAYOUT_IN_PROGRESS",
      "A payout is already pending",
    );
    requireDomain(
      this.#status === "OPEN" || this.#status === "AWAITING_PAYOUT",
      "SESSION_CLOSED",
      "Only an unsettled session can be paid out",
    );
    requireDomain(
      this.#booking.hasEnded(command.now),
      "SESSION_NOT_ENDED",
      "Settlement requires the session to end",
    );
    const next = this.#participations.map((participation) =>
      participation.expireReplacement(command.now),
    );
    requireDomain(
      next.every(
        (participation) =>
          participation.status !== "COMMITTED" ||
          participation.attendance !== "UNVERIFIED",
      ),
      "ATTENDANCE_INCOMPLETE",
      "All committed participants must be finalized before settlement",
    );
    requireDomain(
      command.destination.userId === this.#bookerId,
      "INVALID_INPUT",
      "Payout destination must belong to the booker",
    );
    requireDomain(
      this.#pendingSettlement === undefined,
      "PAYOUT_IN_PROGRESS",
      "A payout is already pending",
    );
    requireDomain(
      !this.#payoutAttemptIds.has(command.payoutId),
      "DUPLICATE_ID",
      "A payout ID can only be used once for this session",
    );
    requireDomain(
      !this.#payoutIdempotencyKeys.has(command.idempotencyKey),
      "DUPLICATE_ID",
      "A payout idempotency key can only be used once for this session",
    );
    const lines: SettlementLine[] = [];
    for (const participation of next) {
      if (
        !(
          participation.status === "COMMITTED" ||
          participation.status === "WITHDRAWN"
        ) ||
        participation.hold === undefined
      )
        continue;
      const hold = participation.hold;
      if (["REFUNDED", "RELEASED", "FORFEITED"].includes(hold.state)) continue;
      requireDomain(
        hold.state === "HELD" || hold.state === "FORFEITURE_DUE",
        "INVALID_STATE",
        "An unsettled commitment has an invalid hold",
      );
      lines.push({
        holdId: hold.holdId,
        participationId: participation.participationId,
        holdingAccountId: hold.holdingAccountId,
        walletId: hold.walletId,
        amount: hold.amount,
        kind:
          participation.status === "WITHDRAWN" ||
          participation.attendance === "ABSENT" ||
          hold.state === "FORFEITURE_DUE"
            ? "FORFEIT"
            : "RELEASE",
      });
    }
    if (lines.length === 0) {
      this.#participations = next;
      this.#status = "SETTLED";
      return undefined;
    }
    const batch: SettlementBatch = {
      payoutId: command.payoutId,
      sessionId: this.#sessionId,
      idempotencyKey: command.idempotencyKey,
      requestedAt: validDate(command.now, "now"),
      destination: command.destination,
      lines,
    };
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
    requireDomain(
      this.#status === "PAYOUT_PENDING" && pending !== undefined,
      "INVALID_STATE",
      "No payout is awaiting completion",
    );
    requireDomain(
      pending.batch.payoutId === payoutId,
      "STALE_PAYOUT",
      "This payout attempt is no longer current",
    );
    const instructions: FinancialInstruction[] = [];
    let next = this.#participations;
    for (const line of pending.batch.lines) {
      const participation = this.requireParticipation(line.participationId);
      requireDomain(
        participation.hold?.holdId === line.holdId,
        "INVALID_STATE",
        "Settlement hold no longer matches the batch",
      );
      const updated = participation.settleHold(line.kind, payoutId, at);
      next = this.replaceIn(next, participation.participationId, updated);
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
    requireDomain(
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
    return this.nextWaitlisted()?.userId;
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
    return Math.max(
      0,
      this.#totalSlots -
        this.#participations.filter((p) => p.status === "COMMITTED").length,
    );
  }

  meetsReliabilityRequirement(score: ReliabilityScore): boolean {
    requireDomain(
      score instanceof ReliabilityScore,
      "INVALID_INPUT",
      "A reliability requirement needs a ReliabilityScore",
    );
    return (
      this.#minimumReliability === undefined ||
      score.meetsMinimum(this.#minimumReliability)
    );
  }

  private commitNew(
    user: User,
    command: JoinCommand,
    existing?: Participation,
  ): AdmissionResult {
    const holdId = command.holdId;
    requireDomain(
      holdId !== undefined,
      "INVALID_INPUT",
      "A commitment needs a hold ID",
    );
    const hold = this.newHold(
      command.participationId,
      holdId,
      user,
      command.now,
    );
    const replacement = this.oldestAwaiting();
    const committed = Participation.createCommitted({
      participationId: existing?.participationId ?? command.participationId,
      userId: user.userId,
      committedAt: command.now,
      hold,
      replacementMode: command.replacementMode,
      replacesParticipationId: replacement?.participationId,
    });
    this.#participations =
      existing === undefined
        ? [...this.#participations, committed]
        : this.replace(existing.participationId, committed);
    const refund = this.refundOldestAwaiting(command.now);
    return {
      kind: "COMMITTED",
      participationId: committed.participationId,
      refundedParticipationId: refund.participationId,
      instructions: [
        this.lockInstruction(committed, command.now),
        ...(refund.instruction === undefined ? [] : [refund.instruction]),
      ],
    };
  }

  private refundOldestAwaiting(at: Date): {
    readonly participationId?: UUID;
    readonly instruction?: FinancialInstruction;
  } {
    const awaiting = this.oldestAwaiting();
    if (awaiting === undefined || awaiting.hold === undefined) return {};
    const refunded = awaiting.refundReplacement(at);
    this.#participations = this.replace(awaiting.participationId, refunded);
    return {
      participationId: awaiting.participationId,
      instruction: this.refundInstruction(refunded, at),
    };
  }

  private oldestAwaiting(): Participation | undefined {
    return this.#participations
      .filter(
        (p) =>
          p.status === "WITHDRAWN" && p.hold?.state === "AWAITING_REPLACEMENT",
      )
      .sort(
        (a, b) =>
          (a.withdrawnAt?.getTime() ?? 0) - (b.withdrawnAt?.getTime() ?? 0),
      )[0];
  }

  private newHold(
    participationId: UUID,
    holdId: UUID,
    user: User,
    now: Date,
  ): FundHold {
    return FundHold.create({
      holdId,
      participationId,
      holdingAccountId: this.#holdingAccountId,
      walletId: user.wallet.walletId,
      amount: this.bookingShare,
      createdAt: now,
    });
  }

  private lockInstruction(
    participation: Participation,
    at: Date,
  ): FinancialInstruction {
    const hold = participation.hold;
    if (hold === undefined)
      throw new DomainError("INVALID_STATE", "A commitment needs a hold");
    return {
      kind: "LOCK",
      sessionId: this.#sessionId,
      participationId: participation.participationId,
      holdId: hold.holdId,
      holdingAccountId: hold.holdingAccountId,
      walletId: hold.walletId,
      amount: hold.amount,
      occurredAt: validDate(at, "at"),
    };
  }

  private refundInstruction(
    participation: Participation,
    at: Date,
  ): FinancialInstruction {
    const hold = participation.hold;
    if (hold === undefined)
      throw new DomainError("INVALID_STATE", "A refund needs a hold");
    return {
      kind: "REFUND",
      sessionId: this.#sessionId,
      participationId: participation.participationId,
      holdId: hold.holdId,
      holdingAccountId: hold.holdingAccountId,
      walletId: hold.walletId,
      amount: hold.amount,
      occurredAt: validDate(at, "at"),
    };
  }

  private assertOpenBefore(at: Date): void {
    validDate(at, "now");
    requireDomain(
      this.#status === "OPEN",
      "SESSION_CLOSED",
      "The session is not open",
    );
    requireDomain(
      !this.#booking.hasStarted(at),
      "SESSION_STARTED",
      "The session has started",
    );
  }

  private assertBooker(actorId: UUID): void {
    requireDomain(
      actorId === this.#bookerId,
      "UNAUTHORIZED",
      "Only the booker may perform this action",
    );
  }

  private assertAccess(
    user: User,
    roomToken?: string,
    replacementToken?: string,
  ): void {
    if (this.#visibility === "PUBLIC") return;
    if (roomToken === this.#roomToken) return;
    if (
      this.#invitedGroupId !== undefined &&
      user.memberGroupIds.includes(this.#invitedGroupId)
    )
      return;
    if (
      replacementToken !== undefined &&
      this.#participations.some(
        (p) =>
          p.status === "WITHDRAWN" &&
          p.hold?.state === "AWAITING_REPLACEMENT" &&
          p.replacementToken === replacementToken,
      )
    )
      return;
    throw new DomainError(
      "INVALID_ACCESS",
      "The user does not have access to this private session",
    );
  }

  private assertEligible(user: User, requireFunds: boolean): void {
    const reason = this.ineligibilityReason(user, requireFunds);
    if (reason === "INACTIVE_ACCOUNT")
      throw new DomainError(
        "INACTIVE_ACCOUNT",
        "An inactive account cannot participate",
      );
    if (reason === "LOW_RELIABILITY")
      throw new DomainError(
        "LOW_RELIABILITY",
        "The user's reliability is below the session requirement",
      );
    if (reason === "INSUFFICIENT_FUNDS")
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        "The wallet cannot fund this commitment",
      );
  }

  private ineligibilityReason(
    user: User,
    requireFunds = true,
  ): "INACTIVE_ACCOUNT" | "LOW_RELIABILITY" | "INSUFFICIENT_FUNDS" | undefined {
    if (user.accountStatus !== "ACTIVE") return "INACTIVE_ACCOUNT";
    const score = user.reliabilityScore;
    if (!this.meetsReliabilityRequirement(score)) return "LOW_RELIABILITY";
    if (
      requireFunds &&
      user.wallet.getFunds().compareTo(this.bookingShare) < 0
    )
      return "INSUFFICIENT_FUNDS";
    return undefined;
  }

  private requireParticipation(id: UUID): Participation {
    const result = this.#participations.find((p) => p.participationId === id);
    if (result === undefined)
      throw new DomainError("NOT_FOUND", "Participation was not found");
    return result;
  }

  private nextWaitlisted(): Participation | undefined {
    return this.#participations
      .filter((p) => p.status === "WAITLISTED")
      .sort((a, b) => (a.queueSequence ?? 0) - (b.queueSequence ?? 0))[0];
  }

  private replace(id: UUID, value: Participation): Participation[] {
    return this.replaceIn(this.#participations, id, value);
  }
  private replaceIn(
    source: readonly Participation[],
    id: UUID,
    value: Participation,
  ): Participation[] {
    return source.map((candidate) =>
      candidate.participationId === id ? value : candidate,
    );
  }

  private markAwaitingPayoutIfComplete(): void {
    if (this.#status !== "OPEN" && this.#status !== "AWAITING_PAYOUT") return;
    const committed = this.#participations.filter(
      (p) => p.status === "COMMITTED",
    );
    if (committed.every((p) => p.attendance !== "UNVERIFIED"))
      this.#status = "AWAITING_PAYOUT";
  }

  private validateRoster(): void {
    requireDomain(
      [
        "OPEN",
        "CANCELLED",
        "AWAITING_PAYOUT",
        "PAYOUT_PENDING",
        "SETTLED",
      ].includes(this.#status),
      "INVALID_INPUT",
      "Unknown session status",
    );
    requireDomain(
      this.#visibility === "PRIVATE" || this.#visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    requireDomain(
      Number.isSafeInteger(this.#totalSlots) &&
        this.#totalSlots > 0 &&
        this.#totalSlots <= 8,
      "INVALID_INPUT",
      "totalSlots must be a safe integer from 1 to 8",
    );
    requireDomain(
      Number.isSafeInteger(this.#minimumHeadcount) &&
        this.#minimumHeadcount >= 2 &&
        this.#minimumHeadcount <= this.#totalSlots,
      "INVALID_INPUT",
      "minimumHeadcount must be between 2 and totalSlots",
    );
    if (this.#minimumReliability !== undefined)
      requireDomain(
        this.#minimumReliability instanceof ReliabilityScore,
        "INVALID_INPUT",
        "minimumReliability must be a ReliabilityScore",
      );
    requireDomain(
      Number.isSafeInteger(this.#nextQueueSequence) &&
        this.#nextQueueSequence > 0,
      "INVALID_INPUT",
      "nextQueueSequence must be a positive safe integer",
    );
    const ids = new Set(this.#participations.map((p) => p.userId));
    requireDomain(
      ids.size === this.#participations.length,
      "DUPLICATE_ID",
      "A user may participate only once in a session",
    );
    const participationIds = new Set(
      this.#participations.map((p) => p.participationId),
    );
    requireDomain(
      participationIds.size === this.#participations.length,
      "DUPLICATE_ID",
      "Participation IDs must be unique in a session",
    );
    const queueSequences = this.#participations
      .map((participation) => participation.queueSequence)
      .filter((sequence): sequence is number => sequence !== undefined);
    requireDomain(
      new Set(queueSequences).size === queueSequences.length,
      "DUPLICATE_ID",
      "Queue sequences must be unique in a session",
    );
    const holdIds = new Set<string>();
    for (const participation of this.#participations) {
      const hold = participation.hold;
      if (hold === undefined) continue;
      requireDomain(
        hold.participationId === participation.participationId,
        "INVALID_INPUT",
        "A hold must belong to its participation",
      );
      requireDomain(
        hold.holdingAccountId === this.#holdingAccountId,
        "INVALID_INPUT",
        "A session hold must use its holding account",
      );
      requireDomain(
        !holdIds.has(hold.holdId),
        "DUPLICATE_ID",
        "Hold IDs must be unique in a session",
      );
      holdIds.add(hold.holdId);
    }
    requireDomain(
      this.#participations.filter((p) => p.status === "COMMITTED").length <=
        this.#totalSlots,
      "CAPACITY_EXCEEDED",
      "Committed participations exceed session capacity",
    );
    if (this.#status === "PAYOUT_PENDING")
      requireDomain(
        this.#pendingSettlement !== undefined,
        "INVALID_INPUT",
        "A pending payout needs a settlement batch",
      );
    if (this.#status !== "PAYOUT_PENDING")
      requireDomain(
        this.#pendingSettlement === undefined,
        "INVALID_INPUT",
        "Only a payout-pending session may have a settlement batch",
      );
    for (const id of this.#payoutAttemptIds)
      requireDomain(
        typeof id === "string" && id.trim() !== "",
        "INVALID_INPUT",
        "Payout attempt IDs are required",
      );
    for (const key of this.#payoutIdempotencyKeys)
      requireDomain(
        typeof key === "string" && key.trim() !== "",
        "INVALID_INPUT",
        "Payout idempotency keys are required",
      );
    if (this.#pendingSettlement !== undefined) {
      validateSettlementBatch(this.#pendingSettlement.batch);
      requireDomain(
        this.#pendingSettlement.batch.sessionId === this.#sessionId,
        "INVALID_INPUT",
        "Settlement batch belongs to another session",
      );
      requireDomain(
        this.#payoutAttemptIds.has(this.#pendingSettlement.batch.payoutId),
        "INVALID_INPUT",
        "Pending payout ID was not recorded",
      );
      requireDomain(
        this.#payoutIdempotencyKeys.has(
          this.#pendingSettlement.batch.idempotencyKey,
        ),
        "INVALID_INPUT",
        "Pending payout key was not recorded",
      );
      const holdById = new Map(
        this.#participations
          .map((participation) => participation.hold)
          .filter((hold): hold is FundHold => hold !== undefined)
          .map((hold) => [hold.holdId, hold]),
      );
      const lineIds = new Set<string>();
      for (const line of this.#pendingSettlement.batch.lines) {
        requireDomain(
          !lineIds.has(line.holdId),
          "DUPLICATE_ID",
          "Settlement lines cannot repeat a hold",
        );
        lineIds.add(line.holdId);
        const hold = holdById.get(line.holdId);
        requireDomain(
          hold !== undefined,
          "INVALID_INPUT",
          "Settlement line references an unknown hold",
        );
        requireDomain(
          hold.participationId === line.participationId &&
            hold.amount.equals(line.amount) &&
            hold.holdingAccountId === line.holdingAccountId &&
            hold.walletId === line.walletId,
          "INVALID_INPUT",
          "Settlement line does not match its hold",
        );
        requireDomain(
          hold.state === "HELD" || hold.state === "FORFEITURE_DUE",
          "INVALID_INPUT",
          "A pending settlement line must reference an unsettled hold",
        );
        requireDomain(
          line.kind === "RELEASE"
            ? hold.state === "HELD" &&
                this.#participations.find(
                  (p) => p.participationId === line.participationId,
                )?.attendance === "ATTENDED"
            : true,
          "INVALID_INPUT",
          "A release line must reference attended funds",
        );
        const participation = this.#participations.find(
          (candidate) => candidate.participationId === line.participationId,
        );
        requireDomain(
          participation !== undefined &&
            (participation.status === "COMMITTED" ||
              participation.status === "WITHDRAWN"),
          "INVALID_INPUT",
          "A settlement line must reference a payable participation",
        );
        requireDomain(
          line.kind === "FORFEIT"
            ? participation.status === "WITHDRAWN" ||
                participation.attendance === "ABSENT" ||
                hold.state === "FORFEITURE_DUE"
            : true,
          "INVALID_INPUT",
          "A forfeit line has an invalid outcome",
        );
      }
    }
    if (this.#status === "SETTLED" || this.#status === "CANCELLED")
      requireDomain(
        this.#participations.every(
          (participation) =>
            participation.hold === undefined ||
            ["REFUNDED", "RELEASED", "FORFEITED"].includes(
              participation.hold.state,
            ),
        ),
        "INVALID_INPUT",
        "A closed session cannot retain active funds",
      );
    if (this.#status === "CANCELLED")
      requireDomain(
        this.#participations.every(
          (participation) => participation.status === "CANCELLED",
        ),
        "INVALID_INPUT",
        "A cancelled session must cancel its participations",
      );
  }
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new DomainError("INVALID_INPUT", `${name} must be a valid Date`);
  return new Date(value.getTime());
}

function requireId(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}

function cloneBatch(batch: SettlementBatch): SettlementBatch {
  return {
    ...batch,
    requestedAt: validDate(batch.requestedAt, "requestedAt"),
    destination: { ...batch.destination },
    lines: batch.lines.map((line) => ({ ...line })),
  };
}

function validatePayoutDestination(destination: PayoutDestination): void {
  requireId(destination.payoutAccountId, "payoutAccountId");
  requireId(destination.userId, "userId");
  requireDomain(
    typeof destination.providerAccountReference === "string" &&
      destination.providerAccountReference.trim() !== "",
    "INVALID_INPUT",
    "providerAccountReference is required",
  );
  requireDomain(
    typeof destination.bankAccountReference === "string" &&
      destination.bankAccountReference.trim() !== "",
    "INVALID_INPUT",
    "bankAccountReference is required",
  );
}

function validateSettlementBatch(batch: SettlementBatch): void {
  requireId(batch.payoutId, "payoutId");
  requireId(batch.sessionId, "sessionId");
  requireDomain(
    typeof batch.idempotencyKey === "string" &&
      batch.idempotencyKey.trim() !== "",
    "INVALID_INPUT",
    "idempotencyKey is required",
  );
  validDate(batch.requestedAt, "requestedAt");
  validatePayoutDestination(batch.destination);
  requireDomain(
    Array.isArray(batch.lines) && batch.lines.length > 0,
    "INVALID_INPUT",
    "A settlement batch needs at least one line",
  );
  const lineIds = new Set<string>();
  for (const line of batch.lines) {
    requireId(line.holdId, "holdId");
    requireId(line.participationId, "participationId");
    requireId(line.holdingAccountId, "holdingAccountId");
    requireId(line.walletId, "walletId");
    requireDomain(
      line.amount instanceof Money && line.amount.toCents() > 0,
      "INVALID_INPUT",
      "Settlement amounts must be positive Money values",
    );
    requireDomain(
      line.kind === "RELEASE" || line.kind === "FORFEIT",
      "INVALID_INPUT",
      "Unknown settlement line kind",
    );
    requireDomain(
      !lineIds.has(line.holdId),
      "DUPLICATE_ID",
      "Settlement lines cannot repeat a hold",
    );
    lineIds.add(line.holdId);
  }
}
