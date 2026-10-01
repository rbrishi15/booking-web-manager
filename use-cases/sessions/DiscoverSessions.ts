import type { Region, Sport, UUID } from "@/domain";
import type { Clock } from "../shared/contracts";

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

export interface SessionDiscoveryCursor {
  readonly startAt: string;
  readonly sessionId: UUID;
}

export interface DiscoverSessionsInput {
  readonly sport?: Sport;
  readonly region?: Region;
  readonly startAtFrom?: Date;
  readonly startAtBefore?: Date;
  readonly cursor?: SessionDiscoveryCursor;
}

export interface SessionDiscoveryQuery extends DiscoverSessionsInput {
  readonly now: Date;
  readonly limit: number;
}

/** Returns PUBLIC, OPEN, strictly upcoming sessions, ordered by start then ID.
 * Full sessions remain discoverable. Date bounds are inclusive/exclusive;
 * cursor comparison is exclusive. Readers never hydrate command aggregates.
 */
export interface SessionDiscoveryReader {
  search(query: SessionDiscoveryQuery): Promise<readonly DiscoveredSession[]>;
}

export interface DiscoverSessionsResult {
  readonly items: readonly DiscoveredSession[];
  readonly nextCursor: SessionDiscoveryCursor | null;
}

export const DISCOVERY_PAGE_SIZE = 20;

/** UC2-01: read public listings in bounded pages using the current clock. */
export class DiscoverSessions {
  constructor(
    private readonly dependencies: {
      readonly reader: SessionDiscoveryReader;
      readonly clock: Clock;
    },
  ) {}

  async search(input: DiscoverSessionsInput): Promise<DiscoverSessionsResult> {
    const rows = await this.dependencies.reader.search({
      ...input,
      now: this.dependencies.clock.now(),
      limit: DISCOVERY_PAGE_SIZE + 1,
    });
    const items = rows.slice(0, DISCOVERY_PAGE_SIZE);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > DISCOVERY_PAGE_SIZE && last !== undefined
          ? { startAt: last.startAt.toISOString(), sessionId: last.sessionId }
          : null,
    };
  }
}
