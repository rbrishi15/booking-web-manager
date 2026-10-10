import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import { SessionApiUnavailableError } from "@/app/sessions/session-api-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { randomUUID } from "node:crypto";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionCreationTransaction } from "@/lib/sessions/postgres-session-creation-transaction";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { CreateSessions } from "@/use-cases/sessions/CreateSessions";

/** Assemble shared infrastructure and submission-scoped session capabilities. */
export function createSessionDependencies(): SessionApiDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    return {
      authenticate: async () => {
        throw new SessionApiUnavailableError();
      },
      createForSubmission: () => {
        throw new SessionApiUnavailableError();
      },
    };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const clock = { now: () => new Date() };
  return {
    authenticate: createSupabaseSessionAuthenticator(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
      { requireEmail: true },
    ),
    createForSubmission: (submission) =>
      new CreateSessions({
        transaction: new PostgresSessionCreationTransaction(
          getPool(),
          submission,
          clock,
        ),
        clock,
        ids: { next: randomUUID },
        holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
      }),
  };
}
