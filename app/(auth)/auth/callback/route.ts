import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HOME_PATH } from "../../redirect-path";

/** UC1-01: finish Supabase's PKCE email confirmation and persist the session in cookies. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  let destination = "/login?verification=failed";
  try {
    const supabase = await createClient();
    let exchanged = false;
    if (code && !request.nextUrl.searchParams.has("error")) {
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        exchanged = error === null && data.session !== null;
      } catch {
        // An unavailable exchange must not discard an existing login session.
      }
    }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error === null && user !== null) {
      const verified = Boolean(user.email?.trim() && user.email_confirmed_at);
      if (exchanged && verified) destination = HOME_PATH;
      else {
        const pending = exchanged || (!code && !request.nextUrl.searchParams.has("error") && request.nextUrl.searchParams.has("message"));
        destination = `/profile/email?verification=${pending ? "pending" : "failed"}`;
      }
    }
  } catch {
    // Keep the public recovery destination when authentication cannot be checked.
  }

  // Never retain the single-use code or untrusted provider error text in the next URL.
  // A relative Location retains this browser's cookie origin even when a proxy
  // supplies an internal request URL. Destinations above are fixed app paths.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: destination, "Cache-Control": "private, no-store" },
  });
}
