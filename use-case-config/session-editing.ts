import type { SessionEditingDependencies } from "@/app/sessions/editing-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionEditingTransaction } from "@/lib/sessions/postgres-session-editing-transaction";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieIdentityAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";
import { EditSession } from "@/use-cases/sessions/EditSession";
import { sessionEditingVersioner } from "@/lib/sessions/session-editing-version";

export function createSessionEditingDependencies(): SessionEditingDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => { throw new SessionManagementUnavailableError(); };
    return { authenticate: unavailable, editSession: { detailsForBooker: unavailable, forBooker: unavailable } };
  }
  const clock = { now: () => new Date() };
  return {
    authenticate: bearerOrLoginCookie(createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
      createSupabaseCookieIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey)),
    editSession: new EditSession({ transaction: new PostgresSessionEditingTransaction(createPostgresPoolProvider(settings.databaseUrl), clock), clock, versioner: sessionEditingVersioner }),
  };
}
