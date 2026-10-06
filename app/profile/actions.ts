"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DomainError } from "@/domain/shared/errors";
import { createUpdateProfile } from "@/use-case-config/profiles";
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

  // 2. Use only the verified identity; persistence rechecks active status atomically.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return { status: "error", message: "Please log in again." };

  try {
    await createUpdateProfile(supabase).forUser(user.id, parsed.data);
  } catch (error) {
    if (error instanceof DomainError && error.code === "INACTIVE_ACCOUNT")
      return { status: "error", message: "This account is no longer active." };
    console.error("UC1-03 profile update failed:", error);
    return { status: "error", message: "We couldn't save your changes. Please try again." };
  }

  // 3. Refresh every signed-in page, so the sidebar shows the new name too.
  revalidatePath("/", "layout");
  return { status: "saved", message: "Your profile has been saved." };
}
