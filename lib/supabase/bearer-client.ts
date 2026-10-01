import { createClient } from "@supabase/supabase-js";
import { getAccountStatus } from "./account-status";

/** Stateless server client: each bearer request supplies its own access token. */
export function createSupabaseAuthClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Read through the caller's RLS identity without mutating the shared auth client. */
export function createBearerAccountStatusReader(url: string, anonKey: string) {
  return (token: string, userId: string) => {
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return getAccountStatus(client, userId);
  };
}
