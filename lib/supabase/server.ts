import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for server code (pages, server actions). Uses the anon key and the user's login cookie. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which can't set cookies.
            // The middleware (Step 20) refreshes them instead.
          }
        },
      },
    },
  );
}