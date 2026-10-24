/**
 * Where users land after registering or logging in.
 * Home lists personal upcoming bookings; Discover requires an active account.
 */
export const HOME_PATH = "/";
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Where to send the user after logging in. Only paths on this site are allowed,
 * so a crafted link like /login?next=https://evil.example cannot redirect elsewhere.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value === "") return HOME_PATH;
  // Browsers ignore tabs/newlines in URLs and treat "\" like "/", so "/\t/evil.example"
  // could become "//evil.example" (another website). Reject them outright.
  if (hasUnsafeCharacters(value)) return HOME_PATH;
  if (!value.startsWith("/") || value.startsWith("//")) return HOME_PATH;
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  if (isAuthPage(pathname) || pathname === AUTH_CALLBACK_PATH) return HOME_PATH;
  return value;
}

/** Carries a validated destination through an app-owned authentication/recovery path. */
export function pathWithNext(path: string, next: unknown): string {
  const destination = safeRedirectPath(next);
  return destination === HOME_PATH ? path : `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ next: destination })}`;
}

/** Only a concrete session's invitation preview is public within the Sessions area. */
export function isSessionInvitationPath(pathname: string): boolean {
  return /^\/sessions\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/join$/i.test(pathname);
}

/** True if the text contains a backslash or an invisible control character (tab, newline, etc.). */
function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || character === "\\") return true;
  }
  return false;
}

/** Pages anyone can open without logging in: Landing, registration, login, terms and privacy. */
const PUBLIC_PATHS: readonly string[] = ["/", "/login", "/register", "/terms", "/privacy", AUTH_CALLBACK_PATH];

/** Protected sections, except the explicitly public invitation preview. */
const PROTECTED_PATHS: readonly string[] = ["/discover", "/groups", "/payouts", "/profile", "/sessions", "/wallet"];

/** Signed-in visitors continue to their validated destination instead of these forms. */
const AUTH_PATHS: readonly string[] = ["/login", "/register"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || isSessionInvitationPath(pathname);
}

export function isProtectedPath(pathname: string): boolean {
  return !isSessionInvitationPath(pathname)
    && PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname);
}
