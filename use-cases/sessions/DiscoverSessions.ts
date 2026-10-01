import type { Region, Sport, UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionDiscoveryTransaction } from "./session-discovery-transaction";

/** Public listing projection: no admission, participant, or payment secrets. */
export interface DiscoveredSession {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly region: Region;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly totalSlots: number;
  readonly bookingShareCents: number;
}

export interface SessionDiscoveryCriteria {
  /** Case-insensitive literal substring of the sport or venue name. */
  readonly text?: string;
  readonly sport?: Sport;
  readonly region?: Region;
  readonly startsWithin?: {
    readonly from?: Date;
    readonly before?: Date;
  };
}

/**
 * UC2-01: authorize the participant and discover all matches in one consistent snapshot.
 * Results are public, open and strictly upcoming, including full sessions,
 * ordered by start time and session ID.
 */
export class DiscoverSessions {
  constructor(
    private readonly dependencies: {
      readonly transaction: SessionDiscoveryTransaction;
      readonly clock: Clock;
    },
  ) {}

  /** The caller supplies the verified participant identity, never a client-chosen ID. */
  async forParticipant(
    participantId: UUID,
    criteria: SessionDiscoveryCriteria = {},
  ): Promise<readonly DiscoveredSession[]> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, participantId, "User");
      user.asParticipant().assertCanDiscoverSessions();

      return sessions.search(criteria, this.dependencies.clock.now());
    });
  }
}
