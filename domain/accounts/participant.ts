import type { JoinCommand, Session } from "@/domain";
import type { AdmissionResult, WithdrawalResult } from "@/domain";
import type { UUID } from "@/domain";
import type { User } from "./user";

/** Action details; the participant supplies its fully loaded User. */
export type ParticipantJoinCommand = JoinCommand;

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
 * User's participant role. It supplies the fully loaded User to session
 * admission, including current account status and loaded related values.
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

  join(session: Session, command: ParticipantJoinCommand): AdmissionResult {
    return session.join(this.#user, command);
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
}
