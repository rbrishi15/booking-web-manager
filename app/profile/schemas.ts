import { z } from "zod";
import { PROFILE_REGIONS as REGIONS, PROFILE_SPORTS as SPORTS } from "@/domain/accounts/profile";
import { userHandleSchema } from "@/app/users/schemas";

/** Removes repeated picks, e.g. ["Tennis", "Tennis"] → ["Tennis"]. */
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** UC1-03 Manage Profile: the Edit profile form. REQ-3 and REQ-4 allow one or more of each; every save keeps a user ID. */
export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(60, "Keep your name under 60 characters"),
  preferredSports: z
    .array(z.enum(SPORTS, { errorMap: () => ({ message: "Choose sports from the list" }) }))
    .min(1, "Choose at least one sport")
    .transform(unique),
  preferredRegions: z
    .array(z.enum(REGIONS, { errorMap: () => ({ message: "Choose regions from the list" }) }))
    .min(1, "Choose at least one region")
    .transform(unique),
  /** The public user ID (ADR-0021), in its stored lower-case form. */
  handle: userHandleSchema,
});

export type ProfileInput = z.infer<typeof profileSchema>;
