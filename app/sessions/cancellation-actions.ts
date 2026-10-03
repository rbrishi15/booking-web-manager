"use server";

import { revalidatePath } from "next/cache";
import { loadDependencies } from "@/app/http/load-dependencies";
import { unauthenticated } from "@/app/http/request-failure";
import { createClient } from "@/lib/supabase/server";
import { getSessionCancellationDependencies } from "./cancellation-server-dependencies";
import { parseCancellationInput, parseCancellationSessionId } from "./cancellation-input";
import { sessionCancellationFailure } from "./cancellation-response";
import type { SessionCancellationResult } from "@/use-cases/sessions/session-cancellation-transaction";
import { withCancellationAction, type ActionableCancellationPreview } from "./session-actions";

export type CancellationActionFailure = { readonly status: "error"; readonly code: string; readonly message: string; readonly refresh: boolean; readonly retrySameRequest: boolean };
export type CancellationPreviewOutcome = { readonly status: "ready"; readonly preview: ActionableCancellationPreview } | CancellationActionFailure;
export type CancellationOutcome = { readonly status: "cancelled"; readonly result: SessionCancellationResult } | CancellationActionFailure;

async function cookieUserId(): Promise<string> {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error) {
    if ([400, 401, 403].includes(error.status ?? 0)) throw unauthenticated();
    throw new Error("Authentication provider failed", { cause: error });
  }
  if (!data.user) throw unauthenticated();
  return data.user.id;
}

function failure(error: unknown): CancellationActionFailure {
  const result = sessionCancellationFailure(error);
  const refresh = result.status === 409;
  if (refresh) revalidatePath("/sessions");
  return { status: "error", code: result.code, message: result.message, refresh,
    retrySameRequest: result.status === 401 || result.status === 403 || result.status >= 500 || result.code === "IDEMPOTENCY_IN_FLIGHT" };
}

export async function previewSessionCancellation(sessionId: string): Promise<CancellationPreviewOutcome> {
  try {
    const dependencies = await loadDependencies(getSessionCancellationDependencies);
    const userId = await cookieUserId();
    return { status: "ready", preview: withCancellationAction(await dependencies.previewCancellation.forBooker(userId, parseCancellationSessionId(sessionId))) };
  } catch (error) { return failure(error); }
}

export async function cancelSession(sessionId: string, submission: { readonly idempotencyKey: string; readonly previewVersion: string }): Promise<CancellationOutcome> {
  try {
    const dependencies = await loadDependencies(getSessionCancellationDependencies);
    const userId = await cookieUserId();
    const input = parseCancellationInput(sessionId, submission);
    const result = await dependencies.createCancellation({ idempotencyKey: input.idempotencyKey }).forBooker(userId, input.sessionId, input.previewVersion);
    revalidatePath("/sessions");
    return { status: "cancelled", result };
  } catch (error) { return failure(error); }
}
