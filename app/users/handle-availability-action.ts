"use server";

import { z } from "zod";
import { UserHandlesUnavailableError } from "./user-handle-dependencies";
import { getUserHandleDependencies } from "./user-handle-server-dependencies";

/** UNKNOWN: the check could not run; the final save still enforces uniqueness. */
export type HandleCheck = "AVAILABLE" | "TAKEN" | "INVALID" | "UNKNOWN";

/**
 * Tells someone choosing a user ID whether it is free (UC1-01, UC1-03). Public, because
 * people check before their account exists; it reveals only taken or free, as Telegram does.
 */
export async function checkUserHandleAvailability(handle: unknown): Promise<HandleCheck> {
  const parsed = z.string().max(64).safeParse(handle);
  if (!parsed.success) return "INVALID";
  try {
    const dependencies = await getUserHandleDependencies();
    return await dependencies.checkUserHandle.availability(parsed.data);
  } catch (error) {
    if (!(error instanceof UserHandlesUnavailableError)) console.error("User ID availability check failed:", error);
    return "UNKNOWN";
  }
}
