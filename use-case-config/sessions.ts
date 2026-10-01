import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import type { SessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionCreationTransaction } from "@/lib/sessions/postgres-session-creation-transaction";
import { createBearerAuthenticator } from "@/lib/supabase/bearer-auth";
import {
  createBearerAccountStatusReader,
  createSupabaseAuthClient,
} from "@/lib/supabase/bearer-client";
import { systemClock, uuidGenerator } from "@/lib/system";
import { CreateSessions } from "@/use-cases/sessions/CreateSessions";

/** Select concrete adapters using validated app settings. */
export function createSessionDependencies(
  settings: SessionServerSettings,
): SessionApiDependencies {
  // The provider defers pool construction until a parsed submission needs a transaction.
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const supabase = createSupabaseAuthClient(
    settings.supabaseUrl,
    settings.supabaseAnonKey,
  );

  return {
    authenticate: createBearerAuthenticator(
      supabase.auth,
      createBearerAccountStatusReader(settings.supabaseUrl, settings.supabaseAnonKey),
    ),
    // Retry identity belongs to one submission, so its transaction and use case are fresh.
    createForSubmission: (submission) =>
      new CreateSessions({
        transaction: new PostgresSessionCreationTransaction(getPool(), submission, systemClock),
        clock: systemClock,
        ids: uuidGenerator,
        holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
      }),
  };
}
