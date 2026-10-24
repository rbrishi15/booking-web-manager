"use server";

import { z } from "zod";
import { loadReliabilityScore } from "@/app/profile/reliability";
import { DomainError } from "@/domain";
import { createClient } from "@/lib/supabase/server";
import { userHandleSchema } from "./schemas";
import { UserHandlesUnavailableError } from "./user-handle-dependencies";
import { getUserHandleDependencies } from "./user-handle-server-dependencies";

/** What the search shows: a found player, nobody, or a message. No internal user UUID leaves the server. */
export type FindPlayerState =
  | { readonly status: "idle" }
  | {
      readonly status: "found";
      readonly player: { readonly handle: string; readonly displayName: string; readonly reliabilityScore: number | null };
    }
  | { readonly status: "not-found"; readonly handle: string }
  | { readonly status: "error"; readonly message: string };

const searchSchema = z.object({ handle: userHandleSchema });

/** ADR-0021: a signed-in player finds another by exact user ID, with that player's reliability score. */
export async function findPlayer(_previous: FindPlayerState, formData: FormData): Promise<FindPlayerState> {
  // 1. Validate at the boundary: the same rules as choosing an ID.
  const parsed = searchSchema.safeParse({ handle: formData.get("handle") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a user ID" };
  const { handle } = parsed.data;

  // 2. Only signed-in players may search.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return { status: "error", message: "Please log in again." };

  // 3. Exact lookup; then the same history-based score Settings shows (null when unavailable).
  try {
    const found = await (await getUserHandleDependencies()).findUserByHandle.forHandle(handle);
    const reliabilityScore = await loadReliabilityScore(found.userId);
    return { status: "found", player: { handle: found.handle, displayName: found.displayName, reliabilityScore } };
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") return { status: "not-found", handle };
    if (error instanceof UserHandlesUnavailableError) return { status: "error", message: "Player search isn't available right now." };
    console.error("Player search failed:", error);
    return { status: "error", message: "We couldn't search right now. Please try again." };
  }
}
