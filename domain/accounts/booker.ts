import type { ReliabilityScore } from "../reliability/reliability-score";
import type { Booking } from "../sessions/booking";
import type { Participation } from "../sessions/participation";
import { refundInstruction } from "../sessions/participation-instructions";
import { Session } from "../sessions/session";
import {
  assertAttendanceOpen,
  assertOpenBefore,
  assertSettlementOpen,
  validatePayoutAttempt,
} from "../sessions/session/session-guards";
import { requireParticipation } from "../sessions/session/session-roster";
import {
  buildSettlementBatch,
  prepareSettlementRoster,
} from "../sessions/session/session-settlement";
import {
  cloneBatch,
  requireId,
  validDate,
  validatePayoutDestination,
} from "../sessions/session/session-validation";
import { DomainError } from "../shared/errors";
import type {
  FinancialInstruction,
  FinancialResult,
  PayoutDestination,
  SettlementBatch,
} from "../shared/operations";
import type { Visibility } from "../shared/statuses";
import type { UUID } from "../shared/types";
import type { User } from "./user";

/**
 * The information a booker supplies when creating a session.
 *
 * Identity, account status, and payout readiness come from the User aggregate;
 * IDs, tokens, and the clock remain application-owned inputs.
 */
export interface BookerSessionCreation {
  readonly sessionId: UUID;
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

export interface AttendanceMark {
  readonly participationId: UUID;
  readonly attendance: "ATTENDED" | "ABSENT";
}

export interface VerifyAttendanceCommand {
  readonly marks: readonly AttendanceMark[];
  readonly now: Date;
}

export interface SettlementCommand {
  readonly payoutId: UUID;
  readonly idempotencyKey: string;
  readonly now: Date;
}

/**
 * User's booker role. Coordinates session creation, authorized administration,
 * cancellation, attendance verification, and settlement preparation.
 * This is a role view over User, with no independently owned aggregate lifecycle.
 * Each workflow prepares its complete result before Session records the state;
 * Session never calls back into the role or obtains actor-supplied account facts.
 */
export class Booker {
  readonly #user: User;

  private constructor(user: User) {
    this.#user = user;
  }

  static for(user: User): Booker {
    return new Booker(user);
  }

  get userId(): UUID {
    return this.#user.userId;
  }

  createSession(details: BookerSessionCreation): Session {
    DomainError.require(
      this.#user.accountStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "An inactive booker cannot create a session",
    );
    DomainError.require(
      this.#user.payoutAccount?.setupStatus === "COMPLETE",
      "PAYOUT_ACCOUNT_NOT_READY",
      "A session needs a completed payout account",
    );
    const now = validDate(details.now, "now");
    const session = new Session({
      sessionId: details.sessionId,
      bookerId: this.#user.userId,
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
      !session.booking.hasStarted(now),
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

  cancel(session: Session, now: Date): FinancialResult {
    this.assertOwnsSession(session.bookerId);
    assertOpenBefore(session.status, session.booking, now);
    const cancelled: Participation[] = [];
    const instructions: FinancialInstruction[] = [];
    for (const participation of session.participations) {
      const change = this.prepareCancellation(
        participation,
        session.sessionId,
        now,
      );
      cancelled.push(change.participation);
      instructions.push(...change.result.instructions);
    }
    const result: FinancialResult = { instructions };
    session.recordCancellation(cancelled, now);
    return result;
  }

  changeVisibility(
    session: Session,
    visibility: "PRIVATE" | "PUBLIC",
    now: Date,
  ): void {
    DomainError.require(
      visibility === "PRIVATE" || visibility === "PUBLIC",
      "INVALID_INPUT",
      "Unknown session visibility",
    );
    this.assertOwnsSession(session.bookerId);
    assertOpenBefore(session.status, session.booking, now);
    DomainError.require(
      session.getAvailableSlots(now) > 0,
      "CAPACITY_EXCEEDED",
      "Visibility cannot change after the session is full",
    );
    session.changeVisibility(visibility, now);
  }

  removeParticipant(
    session: Session,
    participationId: UUID,
    now: Date,
  ): FinancialResult {
    this.assertOwnsSession(session.bookerId);
    assertOpenBefore(session.status, session.booking, now);
    const existing = requireParticipation(
      session.participations,
      participationId,
    );
    const change = this.prepareRemoval(existing, session.sessionId, now);
    session.recordParticipationTransition(existing, change.participation, now);
    return change.result;
  }

  verifyAttendance(session: Session, command: VerifyAttendanceCommand): void {
    validDate(command.now, "now");
    this.assertOwnsSession(session.bookerId);
    assertAttendanceOpen(session.status, session.booking, command.now);
    const participations = session.participations;
    const markedIds = new Set<UUID>();
    const verified: Participation[] = [];
    for (const mark of command.marks) {
      DomainError.require(
        !markedIds.has(mark.participationId),
        "DUPLICATE_ID",
        "A participation may be verified only once per command",
      );
      markedIds.add(mark.participationId);
      const participation = requireParticipation(
        participations,
        mark.participationId,
      );
      verified.push(
        this.prepareAttendance(participation, mark.attendance, command.now),
      );
    }
    session.recordAttendance(verified, command.now);
  }

  prepareSettlement(
    session: Session,
    command: SettlementCommand,
  ): SettlementBatch | undefined {
    const destination = this.payoutDestination();
    requireId(command.payoutId, "payoutId");
    DomainError.require(
      command.idempotencyKey.trim() !== "",
      "INVALID_INPUT",
      "idempotencyKey is required",
    );
    validatePayoutDestination(destination);
    this.assertOwnsSession(session.bookerId);
    assertSettlementOpen(session.status, session.booking, command.now);
    const next = prepareSettlementRoster(
      session.participations,
      session.bookerId,
      destination,
      command.now,
    );
    validatePayoutAttempt(
      session.pendingSettlement,
      session.payoutAttemptIds,
      session.payoutIdempotencyKeys,
      command.payoutId,
      command.idempotencyKey,
    );
    const batch = buildSettlementBatch(
      session.sessionId,
      next,
      command,
      destination,
    );
    const result = batch === undefined ? undefined : cloneBatch(batch);
    session.recordSettlementPreparation(
      {
        payoutId: command.payoutId,
        idempotencyKey: command.idempotencyKey,
        participations: next,
        batch,
      },
      command.now,
    );
    return result;
  }

  /** Role workflows authorize the actor before recording aggregate changes. */
  private assertOwnsSession(bookerId: UUID): void {
    DomainError.require(
      this.userId === bookerId,
      "UNAUTHORIZED",
      "Only the booker may perform this action",
    );
  }

  /** Prepares one cancellation; Session installs the complete roster together. */
  private prepareCancellation(
    participation: Participation,
    sessionId: UUID,
    now: Date,
  ): { participation: Participation; result: FinancialResult } {
    if (
      participation.hold !== undefined &&
      !["REFUNDED", "RELEASED", "FORFEITED"].includes(participation.hold.state)
    ) {
      const refundedHold = participation.hold.refund(now);
      const cancelled = participation.cancel(refundedHold);
      return {
        participation: cancelled,
        result: {
          instructions: [refundInstruction(sessionId, cancelled, now)],
        },
      };
    }
    return {
      participation: participation.cancel(),
      result: { instructions: [] },
    };
  }

  /** A booker's removal always refunds the committed participant's share. */
  private prepareRemoval(
    participation: Participation,
    sessionId: UUID,
    now: Date,
  ): { participation: Participation; result: FinancialResult } {
    DomainError.require(
      participation.status === "COMMITTED" && participation.hold !== undefined,
      "INVALID_STATE",
      "Only a committed participant can be removed",
    );
    const refundedHold = participation.hold.refund(now);
    const removed = participation.remove(refundedHold);
    return {
      participation: removed,
      result: { instructions: [refundInstruction(sessionId, removed, now)] },
    };
  }

  /** Marks a single participation manually without changing the session roster. */
  private prepareAttendance(
    participation: Participation,
    attendance: "ATTENDED" | "ABSENT",
    now: Date,
  ): Participation {
    return participation.verify(attendance, "BOOKER", now);
  }

  /** Reads the current user's validated payout destination for settlement. */
  private payoutDestination(): PayoutDestination {
    return this.#user.payoutDestination();
  }
}
