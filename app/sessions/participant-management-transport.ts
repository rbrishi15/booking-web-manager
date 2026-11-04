"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { userHandleSchema } from "@/app/users/schemas";
import type { FindPlayerState } from "@/app/users/find-player-action";
import { participantRemovalPreviewSchema, participantRemovalResultSchema, sessionParticipantsSchema } from "./participant-management-contract";
import { sessionInvitationOptionsSchema, sessionInviteSummarySchema, type SendSessionInvitationsRequest } from "./session-invitation-contract";

const failureSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const playerSchema = z.object({ user: z.object({ userId: z.string().uuid(), handle: z.string(), displayName: z.string() }) });

export class ParticipantManagementError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

/** Reads are cancelled with their query; writes are attempted once and retried only by the user. */
async function request<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal, body?: unknown): Promise<T> {
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session?.access_token)
      throw new ParticipantManagementError("UNAUTHENTICATED", 401, "Your sign-in has expired. Log in again to continue.");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = failureSchema.safeParse(result);
      const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
      const message = response.status === 401 ? "Your sign-in has expired. Log in again to continue."
        : response.status < 500 && failure.success ? failure.data.error.message : "We couldn't complete this request. Please try again.";
      throw new ParticipantManagementError(code, response.status, message);
    }
    return schema.parse(result);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ParticipantManagementError) throw error;
    throw new ParticipantManagementError("UNKNOWN_RESULT", 0, "We couldn't confirm the result. Please try again.");
  }
}

const path = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
export const loadParticipantInvitationOptions = (id: string, signal?: AbortSignal) => request(`${path(id)}/invitations`, sessionInvitationOptionsSchema, signal);
export const sendParticipantInvitations = (id: string, selection: SendSessionInvitationsRequest) => request(`${path(id)}/invitations`, sessionInviteSummarySchema, undefined, selection);

export async function loadParticipantRoster(id: string, signal?: AbortSignal) {
  const result = await request(`${path(id)}/participants`, sessionParticipantsSchema, signal);
  requireTarget(result, id);
  return result;
}

export async function loadParticipantRemovalPreview(id: string, participationId: string, signal?: AbortSignal) {
  const result = await request(`${path(id)}/participants/${encodeURIComponent(participationId)}/removal-preview`, participantRemovalPreviewSchema, signal);
  requireTarget(result, id, participationId);
  return result;
}

export async function removeParticipantViaApi(id: string, participationId: string, submission: { readonly idempotencyKey: string; readonly previewVersion: string }) {
  const result = await request(`${path(id)}/participants/${encodeURIComponent(participationId)}/remove`, participantRemovalResultSchema, undefined, submission);
  requireTarget(result, id, participationId);
  return result;
}

function requireTarget(result: { readonly sessionId: string; readonly participationId?: string }, sessionId: string, participationId?: string) {
  if (result.sessionId !== sessionId || (participationId !== undefined && result.participationId !== participationId))
    throw new ParticipantManagementError("UNKNOWN_RESULT", 0, "We couldn't confirm the result. Please try again.");
}

export async function findParticipantPlayer(rawHandle: string, currentUserId: string, signal?: AbortSignal): Promise<FindPlayerState> {
  const handle = userHandleSchema.parse(rawHandle);
  try {
    const { user } = await request(`/api/users/${encodeURIComponent(handle)}`, playerSchema, signal);
    return { status: "found", player: { handle: user.handle, displayName: user.displayName, reliabilityScore: null, isSelf: user.userId === currentUserId } };
  } catch (error) {
    if (error instanceof ParticipantManagementError && error.status === 404) return { status: "not-found", handle };
    throw error;
  }
}

export function participantManagementFailure(error: unknown) {
  const failure = error instanceof ParticipantManagementError ? error
    : new ParticipantManagementError("UNKNOWN_RESULT", 0, "We couldn't confirm the result. Please try again.");
  return { status: "error" as const, code: failure.code, message: failure.message, refresh: failure.status === 409,
    retrySameRequest: failure.status === 0 || failure.status === 401 || failure.status === 403 || failure.status >= 500 || failure.code === "IDEMPOTENCY_IN_FLIGHT" };
}

/** One browser-safe boundary, replaced by deterministic adapters in controller stories. */
export const participantManagementApi = {
  loadParticipantInvitationOptions, sendParticipantInvitations, loadParticipantRoster,
  loadParticipantRemovalPreview, removeParticipantViaApi, findParticipantPlayer,
};
