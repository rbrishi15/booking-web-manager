import type { User } from "@/domain";
import type { Repository } from "../shared/contracts";
import type { DiscoveredSession, SessionDiscoveryCriteria } from "./DiscoverSessions";

/** All PUBLIC, OPEN, strictly upcoming summaries, ordered by start then ID.
 * Full sessions remain discoverable. Start bounds are inclusive/exclusive.
 * Readers do not hydrate Session aggregates or truncate the matching results.
 */
export interface SessionDiscoveryReader {
  search(criteria: SessionDiscoveryCriteria, now: Date): Promise<readonly DiscoveredSession[]>;
}

export interface SessionDiscoveryReads {
  readonly users: Pick<Repository<User>, "get">;
  readonly sessions: SessionDiscoveryReader;
}

/** Loads the complete actor and public listings from one consistent transaction snapshot. */
export interface SessionDiscoveryTransaction {
  run<T>(work: (reads: SessionDiscoveryReads) => Promise<T>): Promise<T>;
}
