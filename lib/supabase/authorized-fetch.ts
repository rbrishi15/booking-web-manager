import { createClient } from "./client";

/** The browser could not read its login (storage or Supabase failure); nothing was sent. */
export class SignInUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The browser login could not be read", options);
    this.name = "SignInUnavailableError";
  }
}

/**
 * Calls this app's API as the signed-in browser user. The login lives in Supabase's cookies,
 * but API routes verify a bearer token (lib/supabase/bearer-auth.ts), so this attaches the
 * current access token in one place. Supabase refreshes an expired token before returning it.
 *
 * Returns null, without calling the API, when nobody is signed in. Throws
 * SignInUnavailableError when the login cannot be read; fetch failures propagate unchanged.
 */
export async function fetchAsSignedInUser(url: string, init: RequestInit = {}): Promise<Response | null> {
  let token: string | undefined;
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    token = data.session?.access_token;
  } catch (cause) {
    throw new SignInUnavailableError({ cause });
  }
  if (!token) return null;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
