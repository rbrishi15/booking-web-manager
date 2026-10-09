import { DomainError, type Region, type Sport, type UUID, type Visibility } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionManagementTransaction } from "./session-management-transaction";

/** Host display facts without room tokens, participant identities, or settlement data. */
export interface HostedSession {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly region: Region;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly visibility: Visibility;
  readonly availableSlots: number;
  readonly actions: readonly HostedSessionOperation[];
}

/** UC2-06: an ended session whose committed participants still need the booker's attendance check. */
export interface AttendanceDueSession {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly startAt: Date;
  readonly endAt: Date;
  /** Committed participants not yet marked attended or absent. */
  readonly unverifiedCount: number;
}

export type HostedSessionOperation =
  | { readonly name: "set-visibility"; readonly visibility: Visibility }
  | { readonly name: "preview-cancellation" };

/** A denied transition is absent; unexpected policy failures must still surface. */
function permits(check: () => void): boolean {
  try { check(); return true; }
  catch (error) {
    if (error instanceof DomainError && ["UNAUTHORIZED", "SESSION_STARTED", "SESSION_CLOSED", "CAPACITY_EXCEEDED"].includes(error.code)) return false;
    throw error;
  }
}

export class ListHostedSessions {
  /** Supplies the transaction boundary and clock for account validation and upcoming-session reads. */
  constructor(private readonly dependencies: {
    readonly transaction: SessionManagementTransaction;
    readonly clock: Clock;
  }) {}

  /** Requires an active account and returns display facts and available capacity for its upcoming hosted sessions. */
  async forBooker(bookerId: UUID): Promise<readonly HostedSession[]> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const now = this.dependencies.clock.now();
      const hosted = await sessions.listUpcoming(bookerId, now);
      const booker = user.asBooker();
      return hosted.map((session) => {
        const actions: HostedSessionOperation[] = [];
        const visibility = session.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC";
        if (permits(() => booker.assertCanChangeVisibility(session, visibility, now))) actions.push({ name: "set-visibility", visibility });
        if (permits(() => booker.assertCanCancel(session, now))) actions.push({ name: "preview-cancellation" });
        return {
          sessionId: session.sessionId,
          venueName: session.booking.venueName,
          sport: session.booking.sport,
          region: session.booking.region,
          startAt: session.booking.startAt,
          endAt: session.booking.endAt,
          visibility: session.visibility,
          availableSlots: session.getAvailableSlots(now),
          actions,
        };
      });
    });
  }

  /**
   * UC2-06: the booker's ended sessions that still have unverified committed participants.
   * Verification itself is POST /api/sessions/attendance; unverified places auto-verify 72h after the end.
   */
  async attendanceDueForBooker(bookerId: UUID): Promise<readonly AttendanceDueSession[]> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const ended = await sessions.listEndedOpen(bookerId, this.dependencies.clock.now());
      return ended.flatMap((session) => {
        const unverifiedCount = session.participantList.participations.filter((participation) =>
          participation.status === "COMMITTED" && participation.attendance === "UNVERIFIED").length;
        return unverifiedCount === 0 ? [] : [{
          sessionId: session.sessionId,
          venueName: session.booking.venueName,
          sport: session.booking.sport,
          startAt: session.booking.startAt,
          endAt: session.booking.endAt,
          unverifiedCount,
        }];
      });
    });
  }
}
