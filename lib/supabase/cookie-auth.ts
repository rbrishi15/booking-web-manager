import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { UUID } from "@/domain";
import { requireAccountAccess } from "./account-access";
import { getAccountStatus } from "./account-status";
import { createClient } from "./server";

/**
 * Login-cookie authentication: identifies a same-origin browser request by the Supabase login
 * cookies that `@supabase/ssr` sets, so pages can read API routes with a plain `fetch`.
 *
 * Only GET and HEAD are identified this way. Browsers attach cookies automatically, so a
 * state-changing route that trusted them could be triggered by another site (CSRF); those
 * routes keep requiring a bearer token. An expired access token is refreshed and the new
 * cookies are returned with the response, as the middleware does for pages.
 */
async function verifyLoginCookie(
  request: Request,
  url: string,
  anonKey: string,
): Promise<{ readonly client: SupabaseClient; readonly user: User } | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const client = await createClient(url, anonKey);
  const { data, error } = await client.auth.getUser();
  if (error !== null) {
    // No login, or an expired login that could not be refreshed, is unauthenticated.
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw error;
  }
  return { client, user: data.user };
}

/** Identity-only cookie authentication, for routes whose use cases apply their own account policy. */
export function createSupabaseCookieIdentityAuthenticator(
  url: string,
  anonKey: string,
): (request: Request) => Promise<UUID | null> {
  return async (request) => (await verifyLoginCookie(request, url, anonKey))?.user.id ?? null;
}

/** Cookie authentication with the same account checks as bearer authentication. */
export function createSupabaseCookieSessionAuthenticator(
  url: string,
  anonKey: string,
  options: { readonly requireEmail?: boolean } = {},
): (request: Request) => Promise<UUID | null> {
  return async (request) => {
    const verified = await verifyLoginCookie(request, url, anonKey);
    if (verified === null) return null;
    // Read with the cookie client, so the profile lookup uses this request's (refreshed) login.
    const status = await getAccountStatus(verified.client, verified.user.id);
    return requireAccountAccess(verified.user, status, options);
  };
}
