import type { UUID } from "@/domain";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

/** Authentication checks both verified identity and current active-account access. */
export interface DiscoveryDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly discoverSessions: Pick<DiscoverSessions, "search">;
}
