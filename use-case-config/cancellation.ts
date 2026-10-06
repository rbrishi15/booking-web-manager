import type { SessionCancellationDependencies } from "@/app/sessions/cancellation-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { SessionCancellationVersioner } from "@/lib/sessions/cancellation-versioner";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { PostgresSessionCancellationTransaction } from "@/lib/sessions/postgres-session-cancellation-transaction";
import { CancelSession } from "@/use-cases/sessions/CancelSession";
import { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";

/** Assembles a shared preview and submission-scoped cancellation coordinator. */
export function createSessionCancellationDependencies(): SessionCancellationDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => { throw new SessionManagementUnavailableError(); };
    return { authenticate: unavailable, previewCancellation: { forBooker: unavailable }, createCancellation: () => ({ forBooker: unavailable }) };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const clock = { now: () => new Date() };
  const versioner = new SessionCancellationVersioner();
  return {
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    previewCancellation: new PreviewSessionCancellation({ transaction: new PostgresSessionManagementTransaction(getPool, clock), clock, versioner }),
    createCancellation: ({ idempotencyKey }) => new CancelSession({
      transaction: new PostgresSessionCancellationTransaction(getPool, clock, idempotencyKey), clock, versioner,
    }),
  };
}
