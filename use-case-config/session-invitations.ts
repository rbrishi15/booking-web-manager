import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionInvitationTransaction } from "@/lib/sessions/postgres-session-invitation-transaction";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { createNotificationPublisher } from "./notification-publisher";
import { ManageSessionInvitations } from "@/use-cases/sessions/ManageSessionInvitations";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieIdentityAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";

/** Composition root: the use case knows only its transaction and clock ports. */
export function createSessionInvitationManagementDependencies(): {
  readonly authenticate: (request: Request) => Promise<string | null>;
  readonly invitations: Pick<ManageSessionInvitations, "optionsForBooker" | "inviteByHandles" | "inviteFromGroup">;
} {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => { throw new SessionManagementUnavailableError(); };
    return { authenticate: unavailable, invitations: { optionsForBooker: unavailable, inviteByHandles: unavailable, inviteFromGroup: unavailable } };
  }
  const clock = { now: () => new Date() };
  const transaction = new PostgresSessionInvitationTransaction(
    createPostgresPoolProvider(settings.databaseUrl), clock, createNotificationPublisher(),
  );
  return {
    authenticate: bearerOrLoginCookie(
      createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
      createSupabaseCookieIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    ),
    invitations: new ManageSessionInvitations({ transaction, clock }),
  };
}
