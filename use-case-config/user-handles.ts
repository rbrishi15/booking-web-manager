import { UserHandlesUnavailableError, type UserHandleDependencies } from "@/app/users/user-handle-dependencies";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresExecutor } from "@/lib/database/postgres-executor";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { PostgresUserDirectory } from "@/lib/supabase/postgres-user-directory";
import { CheckUserHandle, FindUserByHandle } from "@/use-cases/accounts/user-handles";

/**
 * Assembles user ID checks and lookups over plain reads; nothing is saved here.
 * Without server settings every call reports UserHandlesUnavailableError.
 */
export function createUserHandleDependencies(): UserHandleDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => {
      throw new UserHandlesUnavailableError();
    };
    return {
      authenticate: unavailable,
      checkUserHandle: { availability: unavailable },
      findUserByHandle: { forHandle: unavailable },
    };
  }
  const directory = new PostgresUserDirectory(createPostgresExecutor(createPostgresPoolProvider(settings.databaseUrl)));
  return {
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    checkUserHandle: new CheckUserHandle(directory),
    findUserByHandle: new FindUserByHandle(directory),
  };
}
