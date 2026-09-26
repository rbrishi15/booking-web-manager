import type { Money } from "../finance/money";
import type { ReliabilityScore } from "../reliability/reliability-score";
import type { Booking } from "../sessions/booking";
import { FundHold } from "../sessions/fund-hold";
import type { Participation } from "../sessions/participation";
import { refundInstruction } from "../sessions/participation-instructions";
import type { Session } from "../sessions/session";
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
 * User's participant role. Owns participant eligibility, funding preparation,
 * and the rules for withdrawing or leaving a waitlist and offering replacements.
 * This is a role view over User, with no independently owned aggregate lifecycle.
 * Session guards its roster and installs the immutable changes prepared here.
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
    return session.admitParticipant(this, command);
  }

  leaveWaitlist(session: Session, command: LeaveWaitlistCommand): void {
    session.removeWaitlistedParticipant(this, command);
  }

  withdraw(
    session: Session,
    command: ParticipantWithdrawalCommand,
  ): WithdrawalResult {
    return session.applyParticipantWithdrawal(this, command);
  }

  offerReplacementToWaitlist(
    session: Session,
    command: ParticipantReplacementOfferCommand,
  ): FinancialResult {
    return session.releaseParticipantReplacement(this, command);
  }

  /** Supplies membership facts to Session's access policy. */
  isMemberOf(groupId: UUID): boolean {
    return this.#user.memberGroupIds.includes(groupId);
  }

  /** Checks actor eligibility without changing either aggregate. */
  assertEligibleFor(terms: AdmissionTerms, requireFunds: boolean): void {
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
  admissionIneligibility(
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
  createAdmissionHold(terms: CommitmentTerms): FundHold {
    return FundHold.create({
      holdId: terms.holdId,
      participationId: terms.participationId,
      holdingAccountId: terms.holdingAccountId,
      walletId: this.#user.wallet.walletId,
      amount: terms.share,
      createdAt: terms.now,
    });
  }

  /** Session checks these action details before its lifecycle guards. */
  validateWithdrawal(command: ParticipantWithdrawalCommand): void {
    if (command.replacementMode !== undefined)
      DomainError.require(
        command.replacementMode === "OPEN_SLOT" ||
          command.replacementMode === "INVITE_LINK",
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
  }

  /** Prepares the entire withdrawal before Session changes its roster. */
  prepareWithdrawal(
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
  prepareWaitlistDeparture(participation: Participation): Participation {
    DomainError.require(
      participation.userId === this.userId,
      "UNAUTHORIZED",
      "Only the participant can leave the waitlist",
    );
    return participation.leaveWaitlist();
  }

  /** Offering a replacement changes its availability without refunding it. */
  prepareReplacementOffer(participation: Participation): {
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
