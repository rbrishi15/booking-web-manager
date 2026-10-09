"use server";

import { createClient } from "@/lib/supabase/server";

/** Each invocation verifies this request's current cookies, never a browser session cache. */
export async function readWalletIdentity(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) return null;
    throw error;
  }
  return user?.id ?? null;
}
