import type { Money } from "../finance/money";
import type { ReliabilityScore } from "../reliability/reliability-score";
import type { JoinCommand, Session } from "../sessions/session";
import { DomainError } from "../shared/errors";
import type {
  AdmissionFacts,
  AdmissionResult,
  WithdrawalResult,
} from "../shared/operations";
import type { UUID } from "../shared/types";
import type { User } from "./user";

/** Authoritative facts needed to decide whether this user can commit funds. */
export interface ParticipantAdmissionFacts {
  readonly walletId: UUID;
  readonly availableBalance: Money;
  readonly memberGroupIds: readonly UUID[];
  readonly score?: ReliabilityScore;
  readonly reliabilityScore?: ReliabilityScore;
}

/** A participant command with identity and account status supplied by User. */
export type ParticipantJoinCommand = Omit<JoinCommand, "facts"> &
  ParticipantAdmissionFacts;

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

/**
 * User's participant role. It supplies actor identity and current account
 * status while leaving wallet, reliability, and group facts to the caller.
 * This is a role view over User, with no independently owned aggregate lifecycle.
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

  join(session: Session, command: ParticipantJoinCommand): AdmissionResult;
  join(session: Session, command: JoinCommand): AdmissionResult;
  join(
    session: Session,
    command: ParticipantJoinCommand | JoinCommand,
  ): AdmissionResult {
    const facts = this.admissionFacts(command);
    return session.join({
      ...command,
      facts,
    });
  }

  leaveWaitlist(session: Session, command: LeaveWaitlistCommand): void {
    session.leaveWaitlist({ actorId: this.#user.userId, ...command });
  }

  withdraw(
    session: Session,
    command: ParticipantWithdrawalCommand,
  ): WithdrawalResult {
    return session.withdrawParticipant({
      actorId: this.#user.userId,
      ...command,
    });
  }

  private admissionFacts(
    command: ParticipantJoinCommand | JoinCommand,
  ): AdmissionFacts {
    if ("facts" in command) {
      if (command.facts.userId !== this.#user.userId)
        throw new DomainError(
          "UNAUTHORIZED",
          "Participant facts belong to another user",
        );
      if (command.facts.accountStatus !== this.#user.accountStatus)
        throw new DomainError(
          "INVALID_INPUT",
          "Participant account status is stale",
        );
      return command.facts;
    }
    return {
      userId: this.#user.userId,
      walletId: command.walletId,
      accountStatus: this.#user.accountStatus,
      availableBalance: command.availableBalance,
      memberGroupIds: [...command.memberGroupIds],
      score: command.score,
      reliabilityScore: command.reliabilityScore,
    };
  }
}
