import type { SessionManagementDependencies } from "@/app/sessions/management-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";

export function createSessionManagementDependencies(): SessionManagementDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => { throw new SessionManagementUnavailableError(); };
    return { authenticate: unavailable, toggleVisibility: { forBooker: unavailable }, listHostedSessions: { forBooker: unavailable } };
  }
  const clock = { now: () => new Date() };
  const transaction = new PostgresSessionManagementTransaction(createPostgresPoolProvider(settings.databaseUrl), clock);
  return {
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    toggleVisibility: new ToggleSessionVisibility({ transaction, clock }),
    listHostedSessions: new ListHostedSessions({ transaction, clock }),
  };
}
