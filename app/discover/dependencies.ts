import type { UUID } from "@/domain";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

/** Session discovery requires verified identity but does not filter public sessions by user. */
export interface DiscoveryDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly discoverSessions: Pick<DiscoverSessions, "searchPublic">;
}
