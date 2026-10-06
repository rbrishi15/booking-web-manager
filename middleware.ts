import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_CALLBACK_PATH, HOME_PATH, isAuthPage, isPublicPath } from "@/app/(auth)/redirect-path";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";

/**
 * Runs before every page. Refreshes the Supabase login cookie, sends logged-out
 * visitors to /login, keeps logged-in users off /login and /register, and signs
 * out deactivated accounts (UC1-04).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  // API routes and public API docs handle authentication themselves. Do not
  // initialize Supabase or refresh cookies before their own availability checks.
  if (pathname.startsWith("/api")) return response;
  // The callback establishes its own session, including when there is no login cookie yet.
  if (pathname === AUTH_CALLBACK_PATH) return response;
  if (pathname === "/storybook" || pathname.startsWith("/storybook/") || pathname.startsWith("/fonts/")) return response;
  if (pathname === "/" && !isAuthenticationConfigured()) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() checks the login with Supabase and refreshes an expiring cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    if (isPublicPath(pathname)) return response;
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectKeepingCookies(loginUrl, response);
  }

  // UC1-04: a deactivated account is signed out and cannot use the app.
  // If the status can't be checked or there is no profile row, sign out too (fail closed).
  const account = await getAccountStatus(supabase, user.id);
  if (account.kind !== "active") {
    await supabase.auth.signOut();
    return redirectKeepingCookies(new URL("/login", request.url), response);
  }

  if (isAuthPage(pathname)) {
    return redirectKeepingCookies(new URL(HOME_PATH, request.url), response);
  }

  return response;
}

/** A redirect that still carries any login cookies Supabase just refreshed or cleared. */
function redirectKeepingCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // Skip Next.js internals, images, and the Stripe webhook (Stripe never logs in).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
