import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { bookingAccountIneligibility, DomainError, type UUID } from "@/domain";
import { getAccountStatus, type AccountStatus } from "./account-status";

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

/** A Supabase user verified for this request, with the access token that proved it. */
export interface VerifiedIdentity {
  readonly token: string;
  readonly userId: UUID;
  readonly user: User;
}

/** Identifies a request that carries no Authorization header, or returns null. */
export type FallbackIdentity = (request: Request) => Promise<VerifiedIdentity | null>;

async function verifyBearerIdentity(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  request: Request,
): Promise<VerifiedIdentity | null> {
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
  return { token, userId: data.user.id, user: data.user };
}

/** The bearer token when an Authorization header is sent; otherwise the fallback, if any. A rejected bearer token never falls back. */
function identify(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  request: Request,
  withoutBearer: FallbackIdentity | undefined,
): Promise<VerifiedIdentity | null> {
  return request.headers.has("authorization") || withoutBearer === undefined
    ? verifyBearerIdentity(auth, request)
    : withoutBearer(request);
}

export function createBearerAuthenticator(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  readStatus: (token: string, userId: UUID) => Promise<AccountStatus>,
  options: {
    readonly requireVerifiedEmail?: boolean;
    /** Used only when the request has no Authorization header; a rejected bearer token never falls back. */
    readonly withoutBearer?: FallbackIdentity;
  } = {},
): (request: Request) => Promise<UUID | null> {
  return async (request) => {
    const identity = await identify(auth, request, options.withoutBearer);
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
      case "active": {
        if (options.requireVerifiedEmail) {
          const reason = bookingAccountIneligibility({
            accountStatus: "ACTIVE",
            hasEmail: Boolean(identity.user.email?.trim()),
            emailVerified: Boolean(identity.user.email_confirmed_at),
          });
          if (reason !== undefined) throw new DomainError(reason, "Verify your email to create or join sessions");
        }
        return identity.userId;
      }
    }
  };
}

/** Identity-only authentication for integrations with their own account policy. */
export function createSupabaseIdentityAuthenticator(
  url: string,
  anonKey: string,
  options: { readonly withoutBearer?: FallbackIdentity } = {},
): (request: Request) => Promise<UUID | null> {
  const verifier = createClient(url, anonKey, { auth: authOptions });
  return async (request) => (await identify(verifier.auth, request, options.withoutBearer))?.userId ?? null;
}

/** Identity verification is shared; each profile read has its own bearer-scoped client. */
export function createSupabaseSessionAuthenticator(
  url: string,
  anonKey: string,
  options: { readonly requireVerifiedEmail?: boolean; readonly withoutBearer?: FallbackIdentity } = {},
) {
  const verifier = createClient(url, anonKey, { auth: authOptions });
  return createBearerAuthenticator(verifier.auth, async (token, userId) => {
    const client = createClient(url, anonKey, {
      auth: authOptions,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return getAccountStatus(client, userId);
  }, options);
}
