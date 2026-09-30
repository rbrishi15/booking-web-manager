import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the profiles table says about a logged-in user (UC1-02, UC1-04).
 * Login and middleware both ask this, so the two checks can't drift apart;
 * each decides its own message, redirect and cookie handling.
 */
export type AccountStatus =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | { readonly kind: "missing-profile" }
  | { readonly kind: "lookup-failed"; readonly code: string | undefined; readonly message: string };

/**
 * Looks up the user's account_status. Anything other than `active` must be treated
 * as "not allowed in" (fail closed): a deleted account, a missing profile row, or a
 * lookup that failed.
 */
export async function getAccountStatus(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
): Promise<AccountStatus> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("user_id", userId)
    .maybeSingle<{ account_status: string }>();

  if (error !== null) return { kind: "lookup-failed", code: error.code, message: error.message };
  if (data === null) return { kind: "missing-profile" };
  return data.account_status === "ACTIVE" ? { kind: "active" } : { kind: "inactive" };
}
