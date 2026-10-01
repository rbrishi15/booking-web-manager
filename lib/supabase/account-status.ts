import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Current profile access for an authenticated user (UC1-04).
 * The session API checks this before both creation and idempotent replay.
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
