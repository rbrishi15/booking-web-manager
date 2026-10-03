import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HOME_PATH } from "../../redirect-path";

/** UC1-01: finish Supabase's PKCE email confirmation and persist the session in cookies. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  let destination = "/login?verification=failed";

  if (code && !request.nextUrl.searchParams.has("error")) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null && data.session !== null) destination = HOME_PATH;
  }

  // Never retain the single-use code or untrusted provider error text in the next URL.
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
