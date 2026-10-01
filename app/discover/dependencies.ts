import type { UUID } from "@/domain";
import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

/** Authentication verifies identity; the use case checks current account access. */
export interface DiscoveryDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly discoverSessions: Pick<DiscoverSessions, "forParticipant">;
}
