import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, type UUID } from "@/domain";
import type { AccountStatus } from "./account-status";

/** Verify both the access token and current account access before any replay. */
export function createBearerAuthenticator(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  readAccountStatus: (token: string, userId: UUID) => Promise<AccountStatus>,
): (request: Request) => Promise<UUID | null> {
  return async (request) => {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer[ \t]+([^\s,]+)$/i);
    const token = match?.[1];
    if (!token) return null;

    const { data, error } = await auth.getUser(token);
    if (error !== null) {
      if ([400, 401, 403].includes(error.status ?? 0)) return null;
      throw error;
    }
    if (data.user === null) {
      throw new Error("Authentication provider returned no user");
    }
    const status = await readAccountStatus(token, data.user.id);
    switch (status.kind) {
      case "inactive":
        throw new DomainError("INACTIVE_ACCOUNT", "An inactive account cannot use the session API");
      case "missing-profile":
        throw new DomainError("NOT_FOUND", "User was not found");
      case "lookup-failed":
        throw new Error("Account status could not be checked", { cause: status });
      case "active":
        break;
    }
    return data.user.id;
  };
}
