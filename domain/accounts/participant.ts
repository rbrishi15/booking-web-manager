import type { Money } from "../finance/money";
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
import {
  availableSlots,
  nextWaitlisted,
  oldestAwaiting,
  requireParticipation,
} from "../sessions/session/session-roster";
import { requireId, validDate } from "../sessions/session/session-validation";
import { DomainError } from "../shared/errors";
import type {
  AdmissionResult,
  FinancialResult,
  PromotionResult,
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
  readonly replacementToken?: string;
  readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
}

export interface ParticipantWithdrawalCommand {
  readonly participationId: UUID;
  readonly now: Date;
  readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
  readonly replacementToken?: string;
}

export interface LeaveWaitlistCommand {
  readonly participationId: UUID;
  readonly now?: Date;
}

export interface ParticipantReplacementOfferCommand {
  readonly participationId: UUID;
  readonly now: Date;
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
 * User's participant role. Coordinates admission, promotion, withdrawal,
 * waitlist departure, and replacement offers using this user's loaded facts.
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

  join(session: Session, command: ParticipantJoinCommand): AdmissionResult {
    requireId(command.participationId, "participationId");
    if (command.holdId !== undefined) requireId(command.holdId, "holdId");
    assertOpenBefore(session.status, session.booking, command.now);
    const participations = session.participations;
    this.assertAccess(session, participations, command);
    const terms = {
      minimumReliability: session.minimumReliability,
      share: session.bookingShare,
    };
    this.assertEligibleFor(terms, false);
    const existing = participations.find((p) => p.userId === this.userId);
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

    validDate(command.now, "now");
    if (
      availableSlots(participations, session.totalSlots) === 0 ||
      nextWaitlisted(participations) !== undefined
    ) {
      const sequence = session.nextQueueSequence;
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
      const result: AdmissionResult = {
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
    const hold = this.createAdmissionHold({
      participationId: command.participationId,
      holdId,
      holdingAccountId: session.holdingAccountId,
      share: terms.share,
      now: command.now,
    });
    const replacement = oldestAwaiting(participations);
    const committed = Participation.createCommitted({
      participationId: existing?.participationId ?? command.participationId,
      userId: this.userId,
      committedAt: command.now,
      hold,
      replacementMode: command.replacementMode,
      replacesParticipationId: replacement?.participationId,
    });
    const refunded = replacement?.refundReplacement(command.now);
    const refund =
      refunded === undefined
        ? undefined
        : refundInstruction(session.sessionId, refunded, command.now);
    const result: AdmissionResult = {
      kind: "COMMITTED",
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

  promoteFromWaitlist(
    session: Session,
    command: PromotionCommand,
  ): PromotionResult {
    assertOpenBefore(session.status, session.booking, command.now);
    const participations = session.participations;
    const next = nextWaitlisted(participations);
    if (next === undefined) return { kind: "NONE", instructions: [] };
    requireId(command.holdId, "holdId");
    validDate(command.now, "now");
    DomainError.require(
      availableSlots(participations, session.totalSlots) > 0,
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
    const replacement = oldestAwaiting(participations);
    const committed = next.commit(
      this.createAdmissionHold({
        participationId: next.participationId,
        holdId: command.holdId,
        holdingAccountId: session.holdingAccountId,
        share: terms.share,
        now: command.now,
      }),
      command.now,
      replacement?.participationId,
    );
    const refunded = replacement?.refundReplacement(command.now);
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
    const existing = requireParticipation(
      session.participations,
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
    const existing = requireParticipation(
      session.participations,
      command.participationId,
    );
    const change = this.prepareWithdrawal(
      existing,
      session.booking,
      command,
      session.sessionId,
    );
    session.recordParticipationTransition(
      existing,
      change.participation,
      command.now,
    );
    return change.result;
  }

  offerReplacementToWaitlist(
    session: Session,
    command: ParticipantReplacementOfferCommand,
  ): FinancialResult {
    assertOpenBefore(session.status, session.booking, command.now);
    const existing = requireParticipation(
      session.participations,
      command.participationId,
    );
    const change = this.prepareReplacementOffer(existing);
    session.recordParticipationTransition(
      existing,
      change.participation,
      command.now,
    );
    return change.result;
  }

  private assertAccess(
    session: Session,
    participations: readonly Participation[],
    command: ParticipantJoinCommand,
  ): void {
    if (command.replacementToken !== undefined) {
      DomainError.require(
        participations.some(
          (p) =>
            p.status === "WITHDRAWN" &&
            p.hold?.state === "AWAITING_REPLACEMENT" &&
            p.replacementToken === command.replacementToken,
        ),
        "INVALID_ACCESS",
        "The replacement link is invalid or no longer available",
      );
      return;
    }
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
    if (requireFunds && this.#user.wallet.getFunds().compareTo(terms.share) < 0)
      return "INSUFFICIENT_FUNDS";
    return undefined;
  }

  /** Prepares a hold after eligibility succeeds; ledger writes remain external. */
  private createAdmissionHold(terms: CommitmentTerms): FundHold {
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
          command.replacementMode === "INVITE_LINK",
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
  }

  /** Prepares the entire withdrawal before Session changes its roster. */
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
      late ? (command.replacementMode ?? "OPEN_SLOT") : undefined,
      late ? command.replacementToken : undefined,
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

  /** Offering a replacement changes its availability without refunding it. */
  private prepareReplacementOffer(participation: Participation): {
    participation: Participation;
    result: FinancialResult;
  } {
    DomainError.require(
      participation.userId === this.userId,
      "UNAUTHORIZED",
      "Only the participant can offer their replacement to the waitlist",
    );
    return {
      participation: participation.offerReplacementToWaitlist(),
      result: { instructions: [] },
    };
  }
}
