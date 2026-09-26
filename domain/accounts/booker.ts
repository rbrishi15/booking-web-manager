import type { ReliabilityScore } from "../reliability/reliability-score";
import type { Booking } from "../sessions/booking";
import type { Participation } from "../sessions/participation";
import { refundInstruction } from "../sessions/participation-instructions";
import { Session } from "../sessions/session";
import { validDate } from "../sessions/session/session-validation";
import { DomainError } from "../shared/errors";
import type {
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
 * User's booker role. Owns session creation, owner authorization, cancellation
 * and removal preparation, manual attendance marks, and payout destination access.
 * This is a role view over User, with no independently owned aggregate lifecycle.
 * Session guards its lifecycle and atomically installs prepared roster changes.
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
    return session.applyBookerCancellation(this, now);
  }

  changeVisibility(
    session: Session,
    visibility: "PRIVATE" | "PUBLIC",
    now: Date,
  ): void {
    session.applyBookerVisibilityChange(this, visibility, now);
  }

  removeParticipant(
    session: Session,
    participationId: UUID,
    now: Date,
  ): FinancialResult {
    return session.applyBookerRemoval(this, participationId, now);
  }

  verifyAttendance(session: Session, command: VerifyAttendanceCommand): void {
    session.applyBookerAttendance(this, command);
  }

  prepareSettlement(
    session: Session,
    command: SettlementCommand,
  ): SettlementBatch | undefined {
    return session.prepareBookerSettlement(this, command);
  }

  /** Session invokes this guard before applying a booker's administration. */
  assertOwnsSession(bookerId: UUID): void {
    DomainError.require(
      this.userId === bookerId,
      "UNAUTHORIZED",
      "Only the booker may perform this action",
    );
  }

  /** Prepares one cancellation; Session installs the complete roster together. */
  prepareCancellation(
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
  prepareRemoval(
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
  prepareAttendance(
    participation: Participation,
    attendance: "ATTENDED" | "ABSENT",
    now: Date,
  ): Participation {
    return participation.verify(attendance, "BOOKER", now);
  }

  /** Reads the current user's validated payout destination for settlement. */
  payoutDestination(): PayoutDestination {
    return this.#user.payoutDestination();
  }
}
