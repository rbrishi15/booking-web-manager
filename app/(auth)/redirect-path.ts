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