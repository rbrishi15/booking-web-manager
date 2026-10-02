import { safeRedirectPath } from "@/app/(auth)/redirect-path";

/** A page-local return destination, independent of discovery's API filters. */
export function discoveryReturnTo(value: unknown): string {
  const safe = safeRedirectPath(value);
  try {
    // Reject malformed encodings and encoded control characters before creating a link.
    const decoded = decodeURIComponent(safe);
    if (safeRedirectPath(decoded) !== decoded) return "/";
  } catch {
    return "/";
  }
  const url = new URL(safe, "https://booking.invalid");
  const path = url.pathname;
  const allowed = path === "/" || ["/sessions", "/wallet", "/groups", "/profile"].some(
    (area) => path === area || path.startsWith(`${area}/`),
  );
  return allowed ? `${path}${url.search}${url.hash}` : "/";
}

export function discoveryHref(query: string, returnTo?: string): string {
  const params = new URLSearchParams(query);
  if (returnTo !== undefined) params.set("returnTo", discoveryReturnTo(returnTo));
  return params.size ? `/discover?${params}` : "/discover";
}
