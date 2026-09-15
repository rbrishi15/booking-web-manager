import { Session, type SessionCreation } from "../sessions/session";
import type {
  FinancialResult,
  PayoutDestination,
  SettlementBatch,
} from "../shared/operations";
import type { UUID } from "../shared/types";
import type { User } from "./user";

/**
 * The information a booker supplies when creating a session.
 *
 * Identity, account status, and payout readiness come from the User aggregate;
 * IDs, tokens, and the clock remain application-owned inputs.
 */
export type BookerSessionCreation = Omit<
  SessionCreation,
  "bookerId" | "bookerStatus" | "payoutReady"
>;

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
 * User's booker role. It supplies the booker's identity to Session commands,
 * keeping actor IDs and payout destinations out of application-facing flows.
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
    return Session.create({
      ...details,
      bookerId: this.#user.userId,
      bookerStatus: this.#user.accountStatus,
      payoutReady: this.#user.payoutAccount?.setupStatus === "COMPLETE",
    });
  }

  cancel(session: Session, now: Date): FinancialResult {
    return session.cancel({ actorId: this.#user.userId, now });
  }

  changeVisibility(
    session: Session,
    visibility: "PRIVATE" | "PUBLIC",
    now: Date,
  ): void {
    session.changeVisibility({
      actorId: this.#user.userId,
      visibility,
      now,
    });
  }

  removeParticipant(
    session: Session,
    participationId: UUID,
    now: Date,
  ): FinancialResult {
    return session.removeParticipant({
      actorId: this.#user.userId,
      participationId,
      now,
    });
  }

  verifyAttendance(session: Session, command: VerifyAttendanceCommand): void {
    session.verifyAttendance({ actorId: this.#user.userId, ...command });
  }

  prepareSettlement(
    session: Session,
    command: SettlementCommand,
  ): SettlementBatch | undefined {
    const destination: PayoutDestination = this.#user.payoutDestination();
    return session.prepareSettlement({
      actorId: this.#user.userId,
      destination,
      ...command,
    });
  }
}
