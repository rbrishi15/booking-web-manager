import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresSessionDiscoveryReader } from "@/lib/sessions/postgres-session-discovery-reader";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

export function createDiscoveryDependencies(): DiscoveryDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => { throw new DiscoveryApiUnavailableError(); };
    return { authenticate: unavailable, discoverSessions: { search: unavailable } };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  // Authentication and query validation happen before the first database pool is opened.
  const sql: SqlExecutor = {
    query: async (statement, values) =>
      (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
  return {
    authenticate: createSupabaseSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    discoverSessions: new DiscoverSessions({
      reader: new PostgresSessionDiscoveryReader(sql),
      clock: { now: () => new Date() },
    }),
  };
}
