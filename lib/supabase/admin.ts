import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client with the service role key: it skips RLS and can manage auth users.
 * SERVER ONLY. Never import this from a "use client" file, and never expose the key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === "" || serviceRoleKey === undefined || serviceRoleKey === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}