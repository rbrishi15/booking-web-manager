import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { FallbackIdentity } from "./bearer-auth";

/**
 * Identifies a same-origin browser request by its Supabase login cookies (set by
 * `@supabase/ssr`), so pages can call read-only API routes with a plain `fetch`.
 *
 * Only GET and HEAD are identified this way. Browsers attach cookies automatically, so a
 * state-changing route that trusted them could be triggered by another site (CSRF); those
 * routes keep requiring a bearer token. An expired access token is refreshed here and the
 * new cookies are returned with the response, as the middleware does for pages.
 */
export function createLoginCookieIdentity(url: string, anonKey: string): FallbackIdentity {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error !== null) {
      // No login, or an expired login that could not be refreshed, is unauthenticated.
      if ([400, 401, 403].includes(error.status ?? 0)) return null;
      throw error;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session === null) return null;
    return { token: session.access_token, userId: data.user.id, user: data.user };
  };
}
