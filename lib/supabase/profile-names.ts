import { createAdminClient } from "./admin";

/**
 * Display names for a list of users, e.g. the members of a group. SERVER ONLY.
 * Deleted accounts (UC1-04) show as "Deleted user"; a blank name shows as "Unnamed player".
 */
export async function displayNames(userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("user_id, display_name, account_status")
    .in("user_id", [...userIds]);
  if (error !== null) throw error;

  for (const row of data) {
    const name = typeof row.display_name === "string" ? row.display_name.trim() : "";
    names.set(row.user_id, row.account_status === "INACTIVE" ? "Deleted user" : name || "Unnamed player");
  }
  return names;
}