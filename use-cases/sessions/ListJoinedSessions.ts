import { DomainError, type AccountStatus, type Region, type Sport, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";

/** A session the participant holds a place in or is waiting for. No roster or payment details. */
export interface JoinedSession {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly region: Region;
  readonly startAt: Date;
  readonly endAt: Date;
  /** COMMITTED holds the participant's share; WAITLISTED holds nothing until a place opens. */
  readonly status: "COMMITTED" | "WAITLISTED";
  /** The session's accepted per-slot share in integer cents. */
  readonly bookingShareCents: number;
}

export interface JoinedSessionsQuery {
  readonly userId: UUID;
  readonly now: Date;
}

export interface JoinedSessionsReader {
  /** The caller's account status, or null when the account has no profile. */
  accountStatus(userId: UUID): Promise<AccountStatus | null>;
  /**
   * The caller's COMMITTED or WAITLISTED places in OPEN sessions starting strictly after now,
   * ordered by start time, then session ID.
   */
  list(query: JoinedSessionsQuery): Promise<readonly JoinedSession[]>;
}

/**
 * UC2-05: the sessions a participant has joined or is waiting for, so they can withdraw or
 * leave the waitlist. The caller supplies the verified participant identity.
 */
export class ListJoinedSessions {
  constructor(
    private readonly dependencies: {
      readonly reader: JoinedSessionsReader;
      readonly clock: Clock;
    },
  ) {}

  /** Requires an active account, like the actions this list leads to. */
  async forParticipant(userId: UUID): Promise<readonly JoinedSession[]> {
    const status = await this.dependencies.reader.accountStatus(userId);
    DomainError.require(status !== null, "NOT_FOUND", "User was not found");
    DomainError.require(status === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage its sessions");
    return this.dependencies.reader.list({ userId, now: this.dependencies.clock.now() });
  }
}
