import type { WithdrawalPreviewDependencies } from "@/app/commit/withdrawal-preview-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { PreviewWithdrawal } from "@/use-cases/sessions/WithdrawalPreview";

/**
 * Assembles the UC2-05 withdrawal preview. It reads through the session
 * management transaction (complete Users and sessions) and saves nothing.
 * Without server settings every call reports SESSION_MANAGEMENT_UNAVAILABLE.
 */
export function createWithdrawalPreviewDependencies(): WithdrawalPreviewDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => {
      throw new SessionManagementUnavailableError();
    };
    return { authenticate: unavailable, previewWithdrawal: { forParticipant: unavailable } };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const clock = { now: () => new Date() };
  return {
    authenticate: createSupabaseIdentityAuthenticator(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
    ),
    previewWithdrawal: new PreviewWithdrawal({
      transaction: new PostgresSessionManagementTransaction(getPool, clock),
      clock,
    }),
  };
}
