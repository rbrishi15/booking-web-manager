import { cache } from "react";
import { type AccountStatus, ReliabilityScore } from "@/domain";
import { createClient } from "./server";

export interface CurrentUser {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly pendingEmail: string | null;
  readonly accountStatus: AccountStatus;
  /** The name to show: the saved name, or the email if no name has been saved yet. */
  readonly displayName: string;
  /** The saved name exactly as stored; may be "" (used to fill the Edit profile form). */
  readonly profileName: string;
  readonly preferredSports: readonly string[];
  readonly preferredRegions: readonly string[];
  /** 0–100 from the domain. Everyone has the starting score until attendance history exists (UC2-06). */
  readonly reliabilityScore: number;
}

/** Keeps only the text items of a database array column (anything else becomes []). */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The logged-in user for server code (layouts, pages, server actions, route handlers), or null.
 * Wrapped in cache() so several calls in one request share a single lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error !== null || user === null) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, preferred_sports, preferred_regions, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  const email = user.email?.trim() || null;
  const savedName: unknown = profile?.display_name;
  const profileName = typeof savedName === "string" ? savedName : "";

  return {
    id: user.id,
    email,
    emailVerified: email !== null && Boolean(user.email_confirmed_at),
    pendingEmail: user.new_email?.trim() || null,
    accountStatus: profileError === null && profile?.account_status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    displayName: profileName.trim() !== "" ? profileName : email ?? "Your account",
    profileName,
    preferredSports: textList(profile?.preferred_sports),
    preferredRegions: textList(profile?.preferred_regions),
    reliabilityScore: ReliabilityScore.fromHistory(user.id, [], new Date()).toNumber(),
  };
});
