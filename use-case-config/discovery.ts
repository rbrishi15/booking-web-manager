import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionDiscoveryTransaction } from "@/lib/sessions/postgres-session-discovery-transaction";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

export function createDiscoveryDependencies(): DiscoveryDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => { throw new DiscoveryApiUnavailableError(); };
    return { authenticate: unavailable, discoverSessions: { forParticipant: unavailable } };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  // Authentication and query validation happen before the first database pool is opened.
  const clock = { now: () => new Date() };
  return {
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    discoverSessions: new DiscoverSessions({
      transaction: new PostgresSessionDiscoveryTransaction(getPool, clock),
      clock,
    }),
  };
}
