import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileChanges } from "@/domain/accounts/profile";
import { DomainError } from "@/domain/shared/errors";
import type { AccountStatus } from "@/domain/shared/statuses";
import type { UUID } from "@/domain/shared/types";
import type { ProfileStore } from "@/use-cases/accounts/update-profile";

/** Uses the caller's authenticated client; the RPC validates that identity again. */
export class SupabaseProfileStore implements ProfileStore {
  constructor(private readonly client: Pick<SupabaseClient, "from" | "rpc">) {}

  async getAccountStatus(userId: UUID): Promise<AccountStatus | null> {
    const { data, error } = await this.client.from("profiles").select("account_status")
      .eq("user_id", userId).maybeSingle<{ account_status: string }>();
    if (error !== null) throw new Error("Profile status could not be read", { cause: error });
    if (data === null) return null;
    if (data.account_status !== "ACTIVE" && data.account_status !== "INACTIVE")
      throw new Error("Stored profile has an invalid account status");
    return data.account_status;
  }

  async saveForActiveUser(userId: UUID, changes: ProfileChanges): Promise<void> {
    const { error } = await this.client.rpc("update_profile", {
      p_user_id: userId,
      p_display_name: changes.displayName,
      p_preferred_sports: [...changes.preferredSports],
      p_preferred_regions: [...changes.preferredRegions],
    });
    if (error === null) return;
    if (error.code === "PRF01") throw new DomainError("INACTIVE_ACCOUNT", "The account is inactive");
    if (error.code === "PRF02") throw new DomainError("INVALID_INPUT", "The profile changes are invalid");
    if (error.code === "PRF03") throw new DomainError("NOT_FOUND", "The profile was not found");
    throw new Error("Profile changes could not be saved", { cause: error });
  }
}
