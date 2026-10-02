"use server";

import { revalidatePath } from "next/cache";
import type { Visibility } from "@/domain";
import { loadDependencies } from "@/app/http/load-dependencies";
import { unauthenticated } from "@/app/http/request-failure";
import { createClient } from "@/lib/supabase/server";
import { getSessionManagementDependencies } from "./management-server-dependencies";
import { parseSessionVisibilityInput } from "./visibility-input";
import { sessionVisibilityFailure } from "./visibility-response";

export type SessionVisibilityActionResult =
  | { readonly status: "saved"; readonly sessionId: string; readonly visibility: Visibility }
  | { readonly status: "error"; readonly code: string; readonly message: string; readonly refresh: boolean };

/** Cookie identity and validated choices reach the same coordinator as the API. */
export async function setSessionVisibility(sessionId: string, visibility: Visibility): Promise<SessionVisibilityActionResult> {
  try {
    const dependencies = await loadDependencies(getSessionManagementDependencies);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if ([400, 401, 403].includes(error.status ?? 0)) throw unauthenticated();
      throw new Error("Authentication provider failed", { cause: error });
    }
    if (!data.user) throw unauthenticated();
    const input = parseSessionVisibilityInput(sessionId, { visibility });
    const result = await dependencies.toggleVisibility.forBooker(data.user.id, input.sessionId, input.visibility);
    revalidatePath("/sessions");
    return { status: "saved", ...result };
  } catch (error) {
    const failure = sessionVisibilityFailure(error);
    const refresh = failure.status === 409;
    if (refresh) revalidatePath("/sessions");
    return { status: "error", code: failure.code, message: failure.message, refresh };
  }
}
