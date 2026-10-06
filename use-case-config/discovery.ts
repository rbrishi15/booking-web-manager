import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { readSessionDatabaseUrl } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionDiscoveryTransaction } from "@/lib/sessions/postgres-session-discovery-transaction";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

export function createDiscoveryDependencies(): DiscoveryDependencies {
  const databaseUrl = readSessionDatabaseUrl();
  if (databaseUrl === undefined) {
    const unavailable = async (): Promise<never> => { throw new DiscoveryApiUnavailableError(); };
    return { discoverSessions: { searchPublic: unavailable } };
  }
  const getPool = createPostgresPoolProvider(databaseUrl);
  // Query validation happens before the first database pool is opened.
  const clock = { now: () => new Date() };
  return {
    discoverSessions: new DiscoverSessions({
      transaction: new PostgresSessionDiscoveryTransaction(getPool),
      clock,
    }),
  };
}
