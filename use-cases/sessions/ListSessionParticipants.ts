import { DomainError, type AttendanceStatus, type ParticipationStatus, type SessionStatus, type Sport, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import { requireParticipantListOwner } from "./participant-removal-preview";
import type { SessionRemovalReadTransaction } from "./session-removal-transaction";

export interface SessionParticipants {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: SessionStatus;
  readonly availableSlots: number;
  /** UC2-06: the session has ended and is still OPEN, so the booker can mark attendance. */
  readonly canVerifyAttendance: boolean;
  readonly participants: readonly {
    readonly participationId: UUID;
    readonly displayName: string;
    readonly status: ParticipationStatus;
    /** UNVERIFIED until the booker (or the 72h auto-verification) marks a committed participant. */
    readonly attendance: AttendanceStatus;
    readonly canRemove: boolean;
  }[];
}

/** UC2-03b: owner-only participant-list display, including historical participants. */
export class ListSessionParticipants {
  constructor(private readonly dependencies: {
    readonly transaction: SessionRemovalReadTransaction;
    readonly clock: Clock;
  }) {}

  async forBooker(bookerId: UUID, sessionId: UUID): Promise<SessionParticipants> {
    return this.dependencies.transaction.run(async ({ users, sessions, participants }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const session = await requireAggregate(sessions, sessionId, "Session");
      requireParticipantListOwner(user, session);
      const participations = session.participantList.participations;
      const names = await participants.displayNames(participations.map((participation) => participation.userId));
      const now = this.dependencies.clock.now();
      const openBeforeStart = session.status === "OPEN" && now < session.booking.startAt;
      return {
        sessionId, venueName: session.booking.venueName, sport: session.booking.sport,
        startAt: session.booking.startAt, endAt: session.booking.endAt, status: session.status,
        availableSlots: session.getAvailableSlots(now),
        canVerifyAttendance: session.status === "OPEN" && session.booking.hasEnded(now),
        participants: participations.map((participation) => ({
          participationId: participation.participationId,
          displayName: names.get(participation.userId) ?? "Unnamed player",
          status: participation.status,
          attendance: participation.attendance,
          canRemove: openBeforeStart && participation.status === "COMMITTED",
        })),
      };
    });
  }
}
