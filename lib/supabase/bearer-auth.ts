import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DomainError, type UUID } from "@/domain";
import { getAccountStatus, type AccountStatus } from "./account-status";

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

async function verifyBearerIdentity(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  request: Request,
): Promise<{ readonly token: string; readonly userId: UUID } | null> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer[ \t]+([^\s,]+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await auth.getUser(token);
  if (error !== null) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw error;
  }
  if (data.user === null)
    throw new Error("Authentication provider returned no user");
  return { token, userId: data.user.id };
}

export function createBearerAuthenticator(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  readStatus: (token: string, userId: UUID) => Promise<AccountStatus>,
): (request: Request) => Promise<UUID | null> {
  return async (request) => {
    const identity = await verifyBearerIdentity(auth, request);
    if (identity === null) return null;
    // Never cache account access: replay can reveal the private room token.
    const status = await readStatus(identity.token, identity.userId);
    switch (status.kind) {
      case "inactive":
        throw new DomainError(
          "INACTIVE_ACCOUNT",
          "An inactive account cannot use the session API",
        );
      case "missing-profile":
        throw new DomainError("NOT_FOUND", "User was not found");
      case "lookup-failed":
        throw new Error("Account status could not be checked", {
          cause: status,
        });
      case "active":
        return identity.userId;
    }
  };
}

/** Discovery loads the complete participant and checks access in its use case. */
export function createSupabaseIdentityAuthenticator(
  url: string,
  anonKey: string,
): (request: Request) => Promise<UUID | null> {
  const verifier = createClient(url, anonKey, { auth: authOptions });
  return async (request) => (await verifyBearerIdentity(verifier.auth, request))?.userId ?? null;
}

/** Identity verification is shared; each profile read has its own bearer-scoped client. */
export function createSupabaseSessionAuthenticator(
  url: string,
  anonKey: string,
) {
  const verifier = createClient(url, anonKey, { auth: authOptions });
  return createBearerAuthenticator(verifier.auth, async (token, userId) => {
    const client = createClient(url, anonKey, {
      auth: authOptions,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return getAccountStatus(client, userId);
  });
}
