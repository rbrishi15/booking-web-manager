import type { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

/** Public listings need only the discovery query. */
export interface DiscoveryDependencies {
  readonly discoverSessions: Pick<DiscoverSessions, "searchPublic">;
}
