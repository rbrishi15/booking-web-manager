import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionDiscoveryTransaction } from "@/lib/sessions/postgres-session-discovery-transaction";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieSessionAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";
import { DiscoverSessions } from "@/use-cases/sessions/DiscoverSessions";

export function createDiscoveryDependencies(): DiscoveryDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => { throw new DiscoveryApiUnavailableError(); };
    return { authenticate: unavailable, discoverSessions: { searchPublic: unavailable } };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  // Shared infrastructure, but verify identity afresh on each request.
  const authenticate = bearerOrLoginCookie(
    createSupabaseSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    createSupabaseCookieSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
  );
  const clock = { now: () => new Date() };
  return {
    authenticate,
    discoverSessions: new DiscoverSessions({
      transaction: new PostgresSessionDiscoveryTransaction(getPool),
      clock,
    }),
  };
}
