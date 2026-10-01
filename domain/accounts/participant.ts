import { Money } from "../finance/money";
import type { ReliabilityScore } from "../reliability/reliability-score";
import type { Booking } from "../sessions/booking";
import { FundHold } from "../sessions/fund-hold";
import { Participation } from "../sessions/participation";
import {
  lockInstruction,
  refundInstruction,
} from "../sessions/participation-instructions";
import type { Session } from "../sessions/session";
import {
  assertOpen,
  assertOpenBefore,
} from "../sessions/session/session-guards";
import { requireId, validDate } from "../sessions/session/session-validation";
import { DomainError } from "../shared/errors";
import type {
  ParticipantJoinResult,
  PromotionResult,
  WithdrawalPreview,
  WithdrawalResult,
} from "../shared/operations";
import type { UUID } from "../shared/types";
import type { User } from "./user";

/** Action details; the participant supplies its user's loaded admission facts. */
export interface ParticipantJoinCommand {
  readonly participationId: UUID;
  readonly holdId?: UUID;
  readonly now: Date;
  readonly roomToken?: string;
}

/** Explicit acceptance by the user named in a pending replacement invitation. */
export interface ParticipantReplacementAcceptanceCommand {
  readonly participationId: UUID;
  readonly holdId: UUID;
  readonly now: Date;
}

export interface ParticipantWithdrawalCommand {
  readonly participationId: UUID;
  readonly now: Date;
  readonly replacementMode?: "OPEN_SLOT" | "DIRECT_INVITE";
  readonly replacementInviteeId?: UUID;
}

export interface LeaveWaitlistCommand {
  readonly participationId: UUID;
  readonly now?: Date;
}

export interface PromotionCommand {
  readonly holdId: UUID;
  readonly now: Date;
}

interface AdmissionTerms {
  readonly minimumReliability?: ReliabilityScore;
  readonly share: Money;
}

interface CommitmentTerms {
  readonly participationId: UUID;
  readonly holdId: UUID;
  readonly holdingAccountId: UUID;
  readonly share: Money;
  readonly now: Date;
}

/**
 * User's participant role. Authorizes discovery and coordinates admission, invitation acceptance,
 * promotion, withdrawal, and waitlist departure using this user's loaded facts.
 * This is a role view over User, with no independently owned aggregate lifecycle.
 * Each workflow prepares its result and immutable child changes before asking
 * Session to record them together. Session never calls back into this role.
 */
export class Participant {
  readonly #user: User;

  private constructor(user: User) {
    this.#user = user;
  }

  static for(user: User): Participant {
    return new Participant(user);
  }

  get userId(): UUID {
    return this.#user.userId;
  }

  /** Discovery needs an active account, without admission or funding requirements. */
  assertCanDiscoverSessions(): void {
    DomainError.require(
      this.#user.accountStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "An inactive account cannot use the session API",
    );
  }

  join(
    session: Session,
    command: ParticipantJoinCommand,
  ): ParticipantJoinResult {
    return this.admit(session, command);
  }

  acceptReplacement(
    session: Session,
    command: ParticipantReplacementAcceptanceCommand,
  ): ParticipantJoinResult {
    requireId(command.participationId, "participationId");
    requireId(command.holdId, "holdId");
    assertOpenBefore(session.status, session.booking, command.now);
    const invitation = session.participantList.personalReplacementForInvitee(
      this.userId,
    );
    DomainError.require(
      invitation !== undefined,
      "INVALID_ACCESS",
      "This user has no pending replacement invitation for this session",
    );
    return this.admit(session, command, invitation);
  }

  private admit(
    session: Session,
    command: ParticipantJoinCommand,
    personalReplacement?: Participation,
  ): ParticipantJoinResult {
    requireId(command.participationId, "participationId");
    if (command.holdId !== undefined) requireId(command.holdId, "holdId");
    assertOpenBefore(session.status, session.booking, command.now);
    const participantList = session.participantList;
    if (personalReplacement === undefined) {
      this.assertAccess(session, command);
      this.assertNoPendingReplacement(session);
    }
    const terms = {
      minimumReliability: session.minimumReliability,
      share: session.bookingShare,
    };
    this.assertEligibleFor(terms, false);
    const existing = participantList.findByUserId(this.userId);
    if (
      existing !== undefined &&
      existing.status !== "LEFT_WAITLIST" &&
      !(existing.status === "WAITLISTED" && personalReplacement !== undefined)
    ) {
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

    validDate(command.now, "now");
    if (
      personalReplacement === undefined &&
      (session.getAvailableSlots() === 0 ||
        participantList.nextWaitlisted() !== undefined)
    ) {
      const sequence = participantList.nextQueueSequence;
      DomainError.require(
        Number.isSafeInteger(sequence) &&
          sequence > 0 &&
          sequence < Number.MAX_SAFE_INTEGER,
        "INVALID_INPUT",
        "Queue sequence overflowed",
      );
      const queued = Participation.createWaitlisted({
        participationId: existing?.participationId ?? command.participationId,
        userId: this.userId,
        waitlistedAt: command.now,
        queueSequence: sequence,
      });
      const result: ParticipantJoinResult = {
        kind: "WAITLISTED",
        participationId: queued.participationId,
        instructions: [],
      };
      session.recordAdmission(queued, undefined, command.now);
      return result;
    }

    this.assertEligibleFor(terms, true);
    const holdId = command.holdId;
    DomainError.require(
      holdId !== undefined,
      "INVALID_INPUT",
      "A commitment needs a hold ID",
    );
    const hold = this.createBookingShareHold({
      participationId: command.participationId,
      holdId,
      holdingAccountId: session.holdingAccountId,
      share: terms.share,
      now: command.now,
    });
    const replacement =
      personalReplacement ?? participantList.oldestAwaitingReplacement();
    const committed =
      existing?.status === "WAITLISTED"
        ? existing.commit(hold, command.now, replacement?.participationId)
        : Participation.createCommitted({
            participationId:
              existing?.participationId ?? command.participationId,
            userId: this.userId,
            committedAt: command.now,
            hold,
            replacesParticipationId: replacement?.participationId,
          });
    const refunded =
      replacement?.hold?.state === "AWAITING_REPLACEMENT"
        ? replacement.refundReplacement(command.now)
        : undefined;
    const refund =
      refunded === undefined
        ? undefined
        : refundInstruction(session.sessionId, refunded, command.now);
    const result: ParticipantJoinResult = {
      kind: "COMMITTED",
      participationId: committed.participationId,
      refundedParticipationId: refunded?.participationId,
      instructions: [
        lockInstruction(session.sessionId, committed, command.now),
        ...(refund === undefined ? [] : [refund]),
      ],
    };
    session.recordAdmission(
      committed,
      refunded ?? personalReplacement,
      command.now,
    );
    return result;
  }

  promoteFromWaitlist(
    session: Session,
    command: PromotionCommand,
  ): PromotionResult {
    assertOpenBefore(session.status, session.booking, command.now);
    const participantList = session.participantList;
    const next = participantList.nextWaitlisted();
    if (next === undefined) return { kind: "NONE", instructions: [] };
    requireId(command.holdId, "holdId");
    validDate(command.now, "now");
    this.assertNoPendingReplacement(session);
    DomainError.require(
      session.getAvailableSlots() > 0,
      "CAPACITY_EXCEEDED",
      "There is no available slot to promote",
    );
    DomainError.require(
      next.userId === this.userId,
      "INVALID_INPUT",
      "Promotion input belongs to another user",
    );
    const terms = {
      minimumReliability: session.minimumReliability,
      share: session.bookingShare,
    };
    const reason = this.admissionIneligibility(terms);
    if (reason !== undefined) {
      const departed = next.leaveWaitlist();
      const result: PromotionResult = {
        kind: "SKIPPED",
        participationId: next.participationId,
        reason,
        instructions: [],
      };
      session.recordParticipationTransition(next, departed, command.now);
      return result;
    }
    const replacement = participantList.oldestAwaitingReplacement();
    const committed = next.commit(
      this.createBookingShareHold({
        participationId: next.participationId,
        holdId: command.holdId,
        holdingAccountId: session.holdingAccountId,
        share: terms.share,
        now: command.now,
      }),
      command.now,
      replacement?.participationId,
    );
    const refunded =
      replacement?.hold?.state === "AWAITING_REPLACEMENT"
        ? replacement.refundReplacement(command.now)
        : undefined;
    const refund =
      refunded === undefined
        ? undefined
        : refundInstruction(session.sessionId, refunded, command.now);
    const result: PromotionResult = {
      kind: "PROMOTED",
      participationId: committed.participationId,
      refundedParticipationId: refunded?.participationId,
      instructions: [
        lockInstruction(session.sessionId, committed, command.now),
        ...(refund === undefined ? [] : [refund]),
      ],
    };
    session.recordAdmission(committed, refunded, command.now);
    return result;
  }

  leaveWaitlist(session: Session, command: LeaveWaitlistCommand): void {
    assertOpen(session.status);
    if (command.now !== undefined)
      assertOpenBefore(session.status, session.booking, command.now);
    const existing = session.participantList.requireParticipation(
      command.participationId,
    );
    const departed = this.prepareWaitlistDeparture(existing);
    session.recordParticipationTransition(existing, departed, command.now);
  }

  withdraw(
    session: Session,
    command: ParticipantWithdrawalCommand,
  ): WithdrawalResult {
    this.validateWithdrawal(command);
    assertOpenBefore(session.status, session.booking, command.now);
    const existing = session.participantList.requireParticipation(
      command.participationId,
    );
    const change = this.prepareWithdrawal(
      existing,
      session.booking,
      command,
      session.sessionId,
    );
    if (command.replacementMode === "DIRECT_INVITE") {
      const invitee =
        command.replacementInviteeId === undefined
          ? undefined
          : session.participantList.findByUserId(command.replacementInviteeId);
      DomainError.require(
        invitee === undefined ||
          invitee.status === "WAITLISTED" ||
          invitee.status === "LEFT_WAITLIST",
        "INVALID_STATE",
        "The invited replacement must be able to join this session",
      );
    }
    session.recordParticipationTransition(
      existing,
      change.participation,
      command.now,
    );
    return change.result;
  }

  /**
   * Read-only preview of `withdraw` at `now`, so the refund can be shown
   * before the irreversible action. Applies the same authorization, lifecycle
   * and 30-hour rule as `withdraw` and changes neither the session nor the
   * participation. The replacement choice does not affect the refund.
   */
  previewWithdrawal(session: Session, now: Date): WithdrawalPreview {
    assertOpenBefore(session.status, session.booking, now);
    const existing = session.participantList.findByUserId(this.userId);
    DomainError.require(
      existing !== undefined,
      "NOT_FOUND",
      "This user is not participating in the session",
    );
    const { result } = this.prepareWithdrawal(
      existing,
      session.booking,
      { participationId: existing.participationId, now },
      session.sessionId,
    );
    const refund = result.instructions.find(
      (instruction) => instruction.kind === "REFUND",
    );
    return {
      kind: result.kind,
      participationId: result.participationId,
      refundAmount: refund?.amount ?? Money.fromCents(0),
      heldAmount: existing.hold?.amount ?? Money.fromCents(0),
    };
  }

  private assertAccess(
    session: Session,
    command: ParticipantJoinCommand,
  ): void {
    if (session.visibility === "PUBLIC") return;
    if (command.roomToken === session.roomToken) return;
    if (
      session.invitedGroupId !== undefined &&
      this.#user.memberGroupIds.includes(session.invitedGroupId)
    )
      return;
    throw new DomainError(
      "INVALID_ACCESS",
      "The user does not have access to this private session",
    );
  }

  private assertNoPendingReplacement(session: Session): void {
    DomainError.require(
      session.participantList.personalReplacementForInvitee(this.userId) ===
        undefined,
      "INVALID_STATE",
      "Accept the pending replacement invitation explicitly before joining",
    );
  }

  /** Checks actor eligibility without changing either aggregate. */
  private assertEligibleFor(
    terms: AdmissionTerms,
    requireFunds: boolean,
  ): void {
    const reason = this.admissionIneligibility(terms, requireFunds);
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

  /** Promotion uses the same policy but reports a skipped participant. */
  private admissionIneligibility(
    terms: AdmissionTerms,
    requireFunds = true,
  ): PromotionResult["reason"] {
    if (this.#user.accountStatus !== "ACTIVE") return "INACTIVE_ACCOUNT";
    if (
      terms.minimumReliability !== undefined &&
      !this.#user.reliabilityScore.meetsMinimum(terms.minimumReliability)
    )
      return "LOW_RELIABILITY";
    if (
      requireFunds &&
      this.#user.wallet.getAvailableBalance().compareTo(terms.share) < 0
    )
      return "INSUFFICIENT_FUNDS";
    return undefined;
  }

  /** Prepares a hold after eligibility succeeds; ledger writes remain external. */
  private createBookingShareHold(terms: CommitmentTerms): FundHold {
    return FundHold.create({
      holdId: terms.holdId,
      participationId: terms.participationId,
      holdingAccountId: terms.holdingAccountId,
      walletId: this.#user.wallet.walletId,
      amount: terms.share,
      createdAt: terms.now,
    });
  }

  /** Invalid action details retain precedence over session lifecycle errors. */
  private validateWithdrawal(command: ParticipantWithdrawalCommand): void {
    if (command.replacementMode !== undefined)
      DomainError.require(
        command.replacementMode === "OPEN_SLOT" ||
          command.replacementMode === "DIRECT_INVITE",
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
    if (command.replacementInviteeId !== undefined)
      DomainError.require(
        command.replacementInviteeId !== this.userId,
        "INVALID_INPUT",
        "A participant cannot invite themselves as their replacement",
      );
  }

  /** Prepares the entire withdrawal before Session changes its participant list. */
  private prepareWithdrawal(
    participation: Participation,
    booking: Booking,
    command: ParticipantWithdrawalCommand,
    sessionId: UUID,
  ): { participation: Participation; result: WithdrawalResult } {
    this.validateWithdrawal(command);
    DomainError.require(
      participation.userId === this.userId,
      "UNAUTHORIZED",
      "Only the participant can withdraw",
    );
    DomainError.require(
      participation.status === "COMMITTED" && participation.hold !== undefined,
      "INVALID_STATE",
      "Only a committed participant can withdraw",
    );
    const hold = participation.hold;
    const late = booking.hoursUntilStart(command.now) <= 30;
    const nextHold = late ? hold.awaitReplacement() : hold.refund(command.now);
    const next = participation.withdraw(
      nextHold,
      command.now,
      command.replacementMode ?? "OPEN_SLOT",
      command.replacementInviteeId,
    );
    return {
      participation: next,
      result: {
        kind: late ? "AWAITING_REPLACEMENT" : "REFUNDED",
        participationId: participation.participationId,
        instructions: late
          ? []
          : [refundInstruction(sessionId, next, command.now)],
      },
    };
  }

  /** Only the owner may prepare this immutable waitlist transition. */
  private prepareWaitlistDeparture(
    participation: Participation,
  ): Participation {
    DomainError.require(
      participation.userId === this.userId,
      "UNAUTHORIZED",
      "Only the participant can leave the waitlist",
    );
    return participation.leaveWaitlist();
  }
}
