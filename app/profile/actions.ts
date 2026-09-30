"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileSchema } from "./schemas";

type ProfileField = "displayName" | "preferredSports" | "preferredRegions";

export interface ProfileState {
  readonly status: "idle" | "error" | "saved";
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<ProfileField, string[]>>;
}

/** UC1-03 Manage Profile: checks the form, then saves the name and preferences of the logged-in user. */
export async function updateProfile(_previous: ProfileState, formData: FormData): Promise<ProfileState> {
  // 1. Validate at the boundary. getAll() collects every ticked checkbox with that name.
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    preferredSports: formData.getAll("preferredSports"),
    preferredRegions: formData.getAll("preferredRegions"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // 2. Only ever update the logged-in user's own row. RLS enforces this too.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return { status: "error", message: "Please log in again." };

  const { error, count } = await supabase
    .from("profiles")
    .update(
      {
        display_name: parsed.data.displayName,
        preferred_sports: parsed.data.preferredSports,
        preferred_regions: parsed.data.preferredRegions,
      },
      { count: "exact" },
    )
    .eq("user_id", user.id);
  if (error !== null || count !== 1) {
    console.error("UC1-03 profile update failed:", error?.code, error?.message, count);
    return { status: "error", message: "We couldn't save your changes. Please try again." };
  }

  // 3. Refresh every signed-in page, so the sidebar shows the new name too.
  revalidatePath("/", "layout");
  return { status: "saved", message: "Your profile has been saved." };
}