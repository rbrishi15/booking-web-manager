import type { UUID } from "@/domain";

export type RequestAuthenticator = (request: Request) => Promise<UUID | null>;

/**
 * Chooses one authentication policy per request: the bearer policy when an Authorization
 * header is sent, the login-cookie policy otherwise. The policies stay separate, so a
 * rejected bearer token is never retried with cookies.
 */
export function bearerOrLoginCookie(bearer: RequestAuthenticator, loginCookie: RequestAuthenticator): RequestAuthenticator {
  return (request) => request.headers.has("authorization") ? bearer(request) : loginCookie(request);
}
