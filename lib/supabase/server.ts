import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server code (pages, server actions, route handlers). Uses the anon key
 * and the user's login cookie. Callers with validated settings pass their URL and key.
 */
export async function createClient(
  url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
) {
  const cookieStore = await cookies();

  return createServerClient(
    url,
    anonKey,
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
            // The middleware (Step 20) refreshes them instead. Route handlers can set them.
          }
        },
      },
    },
  );
}