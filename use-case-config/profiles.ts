import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseProfileStore } from "@/lib/supabase/profile-store";
import { UpdateProfile } from "@/use-cases/accounts/update-profile";

/** The authenticated client belongs to this server request and is never shared. */
export function createUpdateProfile(client: Pick<SupabaseClient, "from" | "rpc">): UpdateProfile {
  return new UpdateProfile(new SupabaseProfileStore(client));
}
