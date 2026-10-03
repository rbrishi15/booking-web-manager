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
      return hosted.map((session) => ({
        sessionId: session.sessionId,
        venueName: session.booking.venueName,
        sport: session.booking.sport,
        region: session.booking.region,
        startAt: session.booking.startAt,
        endAt: session.booking.endAt,
        visibility: session.visibility,
        availableSlots: session.getAvailableSlots(now),
      }));
    });
  }
}
