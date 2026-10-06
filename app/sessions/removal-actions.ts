"use server";

import { revalidatePath } from "next/cache";
import { loadDependencies } from "@/app/http/load-dependencies";
import { unauthenticated } from "@/app/http/request-failure";
import { createClient } from "@/lib/supabase/server";
import type { ParticipantRemovalPreview } from "@/use-cases/sessions/PreviewParticipantRemoval";
import type { SessionParticipantRemovalResult } from "@/use-cases/sessions/session-removal-transaction";
import { getSessionRemovalDependencies } from "./removal-server-dependencies";
import { parseRemovalInput, parseRemovalParams, parseRemovalSessionId } from "./removal-input";
import { participantRemovalFailure } from "./removal-response";
import { serializeSessionParticipants, type SessionParticipants } from "./removal-types";

export type RemovalActionFailure = { readonly status: "error"; readonly code: string; readonly message: string; readonly refresh: boolean; readonly retrySameRequest: boolean };
export type SessionParticipantsOutcome = { readonly status: "ready"; readonly session: SessionParticipants } | RemovalActionFailure;
export type ParticipantRemovalPreviewOutcome = { readonly status: "ready"; readonly preview: ParticipantRemovalPreview } | RemovalActionFailure;
export type ParticipantRemovalOutcome = { readonly status: "removed"; readonly result: SessionParticipantRemovalResult } | RemovalActionFailure;

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

function refreshParticipants(sessionId: string): void {
  revalidatePath("/sessions");
  revalidatePath(`/sessions/${sessionId}/participants`);
}

function failure(error: unknown, sessionId: string): RemovalActionFailure {
  const result = participantRemovalFailure(error);
  const refresh = result.status === 409;
  if (refresh) refreshParticipants(sessionId);
  return { status: "error", code: result.code, message: result.message, refresh,
    retrySameRequest: result.status >= 500 || result.code === "IDEMPOTENCY_IN_FLIGHT" };
}

export async function listSessionParticipants(sessionId: string): Promise<SessionParticipantsOutcome> {
  try {
    const dependencies = await loadDependencies(getSessionRemovalDependencies);
    const userId = await cookieUserId();
    const session = await dependencies.listParticipants.forBooker(userId, parseRemovalSessionId(sessionId));
    return { status: "ready", session: serializeSessionParticipants(session) };
  } catch (error) { return failure(error, sessionId); }
}

export async function previewParticipantRemoval(sessionId: string, participationId: string): Promise<ParticipantRemovalPreviewOutcome> {
  try {
    const dependencies = await loadDependencies(getSessionRemovalDependencies);
    const userId = await cookieUserId();
    const input = parseRemovalParams(sessionId, participationId);
    return { status: "ready", preview: await dependencies.previewRemoval.forBooker(userId, input.sessionId, input.participationId) };
  } catch (error) { return failure(error, sessionId); }
}

export async function removeParticipant(sessionId: string, participationId: string, submission: { readonly idempotencyKey: string; readonly previewVersion: string }): Promise<ParticipantRemovalOutcome> {
  try {
    const dependencies = await loadDependencies(getSessionRemovalDependencies);
    const userId = await cookieUserId();
    const input = parseRemovalInput(sessionId, participationId, submission);
    const result = await dependencies.createRemoval({ idempotencyKey: input.idempotencyKey })
      .forBooker(userId, input.sessionId, input.participationId, input.previewVersion);
    refreshParticipants(input.sessionId);
    return { status: "removed", result };
  } catch (error) { return failure(error, sessionId); }
}
