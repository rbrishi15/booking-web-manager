import { headers } from "next/headers";
import { AUTH_CALLBACK_PATH } from "./redirect-path";

/** Server Actions validate Origin against Host; use that origin for this browser's PKCE cookie. */
export async function emailConfirmationRedirectTo(): Promise<string | null> {
  const origin = (await headers()).get("origin");
  if (origin === null) return null;

  try {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
      return null;
    }
    return new URL(AUTH_CALLBACK_PATH, url).href;
  } catch {
    return null;
  }
}
