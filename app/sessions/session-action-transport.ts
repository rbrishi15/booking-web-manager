"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { SessionVisibilityActionResult } from "./actions";
import type { CancellationActionFailure, CancellationOutcome, CancellationPreviewOutcome } from "./cancellation-actions";
import { cancelSessionAction, previewSessionCancellationAction, type CancelSessionAction, type PreviewSessionCancellationAction, type SetSessionVisibilityAction } from "./session-actions";

const failureSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const visibilitySchema = z.object({ sessionId: z.string().min(1), visibility: z.enum(["PUBLIC", "PRIVATE"]) });
const cancellationSchema = z.object({ sessionId: z.string().min(1), status: z.literal("CANCELLED"), refundRecipientCount: z.number().int().nonnegative(), totalRefundCents: z.number().int().safe().nonnegative() });
const cancelActionSchema = z.object({ name: z.literal("cancel-session"), href: z.string().min(1), method: z.literal("POST"), inputs: z.object({ previewVersion: z.string().regex(/^[a-f0-9]{64}$/) }) });
const previewSchema = z.object({ sessionId: z.string().min(1), affectedParticipantCount: z.number().int().nonnegative(), refundRecipientCount: z.number().int().nonnegative(), totalRefundCents: z.number().int().safe().nonnegative(), previewVersion: z.string().regex(/^[a-f0-9]{64}$/), actions: z.array(cancelActionSchema).min(1) });

async function requestAction(action: SetSessionVisibilityAction | PreviewSessionCancellationAction | CancelSessionAction, inputs?: { readonly idempotencyKey: string }): Promise<Response> {
  const { data, error } = await createClient().auth.getSession();
  if (error) throw new Error("Authentication unavailable");
  const token = data.session?.access_token;
  if (!token) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Your sign-in has expired. Sign in again to continue." } }, { status: 401 });
  return fetch(action.href, { method: action.method, headers: { Authorization: `Bearer ${token}`, ...(action.method === "GET" ? {} : { "Content-Type": "application/json" }) },
    ...(action.method === "GET" ? {} : { body: JSON.stringify({ ...inputs, ...action.inputs }) }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
}

function failure(response: Response, body: unknown): CancellationActionFailure {
  const parsed = failureSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : "UNEXPECTED_ERROR";
  return { status: "error", code, message: parsed.success ? parsed.data.error.message : "We couldn't complete this request. Please try again.",
    // Access rejection cannot tell us whether an earlier cancellation committed.
    refresh: response.status === 409, retrySameRequest: response.status === 401 || response.status === 403 || response.status >= 500 || code === "IDEMPOTENCY_IN_FLIGHT" };
}

export async function executeSessionVisibility(action: SetSessionVisibilityAction): Promise<SessionVisibilityActionResult> {
  try {
    const response = await requestAction(action);
    const body: unknown = await response.json();
    if (response.ok) return { status: "saved", ...visibilitySchema.parse(body) };
    const rejected = failure(response, body);
    return { status: "error", code: rejected.code, message: rejected.message, refresh: rejected.refresh };
  } catch {
    return { status: "error", code: "UNEXPECTED_ERROR", message: "We couldn't change visibility. Please try again.", refresh: false };
  }
}

export async function loadCancellationPreview(sessionId: string, action: PreviewSessionCancellationAction = previewSessionCancellationAction(sessionId)): Promise<CancellationPreviewOutcome> {
  try {
    const response = await requestAction(action);
    const body: unknown = await response.json();
    return response.ok ? { status: "ready", preview: previewSchema.parse(body) } : failure(response, body);
  } catch {
    return { status: "error", code: "UNEXPECTED_ERROR", message: "We couldn't load the refunds. Please try again.", refresh: false, retrySameRequest: true };
  }
}

export async function executeSessionCancellation(sessionId: string, submission: { readonly idempotencyKey: string; readonly previewVersion: string }, action: CancelSessionAction = cancelSessionAction(sessionId, submission.previewVersion)): Promise<CancellationOutcome> {
  try {
    const response = await requestAction(action, { idempotencyKey: submission.idempotencyKey });
    const body: unknown = await response.json();
    return response.ok ? { status: "cancelled", result: cancellationSchema.parse(body) } : failure(response, body);
  } catch {
    return { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm the result. Retry this cancellation using the saved request.", refresh: false, retrySameRequest: true };
  }
}
