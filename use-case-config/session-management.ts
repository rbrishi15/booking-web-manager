import type { SessionManagementDependencies } from "@/app/sessions/management-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { createLoginCookieIdentity } from "@/lib/supabase/cookie-auth";
import { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";

/** Builds authentication and session use cases from server settings, or failing adapters when configuration is missing. */
export function createSessionManagementDependencies(): SessionManagementDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    /** Rejects operations with the public unavailable error when required server settings are absent. */
    const unavailable = async (): Promise<never> => { throw new SessionManagementUnavailableError(); };
    return { authenticate: unavailable, toggleVisibility: { forBooker: unavailable }, listHostedSessions: { forBooker: unavailable, attendanceDueForBooker: unavailable } };
  }
  const clock = { now: () => new Date() };
  const transaction = new PostgresSessionManagementTransaction(createPostgresPoolProvider(settings.databaseUrl), clock);
  return {
    // The Sessions page reads with its login cookies; changes (PATCH) still need a bearer token.
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey, {
      withoutBearer: createLoginCookieIdentity(settings.supabaseUrl, settings.supabaseAnonKey),
    }),
    toggleVisibility: new ToggleSessionVisibility({ transaction, clock }),
    listHostedSessions: new ListHostedSessions({ transaction, clock }),
  };
}
