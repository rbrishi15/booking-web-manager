/** Dialog map: after registering or logging in, users land on Home & Discover. */
export const HOME_PATH = "/discover";

/**
 * Where to send the user after logging in. Only paths on this site are allowed,
 * so a crafted link like /login?next=https://evil.example cannot redirect elsewhere.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value === "") return HOME_PATH;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return HOME_PATH;
  if (value.startsWith("/login") || value.startsWith("/register")) return HOME_PATH;
  return value;
}

/** Pages anyone can open without logging in: Landing, Register and Log in (dialog map). */
const PUBLIC_PATHS: readonly string[] = ["/", "/login", "/register"];

/** Pages a logged-in user has no reason to see; they are sent Home instead. */
const AUTH_PATHS: readonly string[] = ["/login", "/register"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname);
}