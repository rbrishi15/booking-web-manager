import { cache } from "react";
import { ReliabilityScore } from "@/domain";
import { createClient } from "./server";

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** 0–100 from the domain. Everyone has the starting score until attendance history exists (UC2-06). */
  readonly reliabilityScore: number;
}

/**
 * The logged-in user for server code (layouts, pages, server actions, route handlers), or null.
 * Wrapped in cache() so several calls in one request share a single lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const email = user.email ?? "";
  const savedName: unknown = profile?.display_name;
  const displayName = typeof savedName === "string" && savedName.trim() !== "" ? savedName : email;

  return {
    id: user.id,
    email,
    displayName,
    reliabilityScore: ReliabilityScore.fromHistory(user.id, [], new Date()).toNumber(),
  };
});