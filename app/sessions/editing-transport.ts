"use client";

import { createClient } from "@/lib/supabase/client";
import { sessionEditingDetailsSchema, type SessionEditRequest, type SessionEditingDetails } from "./editing-contract";

export class SessionEditingError extends Error {
  constructor(readonly code: string, message: string, readonly reload: boolean) { super(message); }
}

export interface SessionEditingTransport {
  load(sessionId: string, signal?: AbortSignal): Promise<SessionEditingDetails>;
  save(sessionId: string, input: SessionEditRequest): Promise<SessionEditingDetails>;
}

async function request(sessionId: string, input?: SessionEditRequest, signal?: AbortSignal): Promise<SessionEditingDetails> {
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session?.access_token)
      throw new SessionEditingError("UNAUTHENTICATED", "Your sign-in has expired. Log in again to continue.", false);
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/edit`, {
      method: input ? "PATCH" : "GET", cache: "no-store", credentials: "same-origin",
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = readFailure(body);
      throw new SessionEditingError(failure?.code ?? "UNEXPECTED_ERROR",
        response.status === 401 ? "Your sign-in has expired. Log in again to continue."
          : response.status < 500 && failure ? failure.message
          : input ? "We couldn't save the session. Please try again." : "We couldn't load this session. Please try again.",
        response.status === 409 || response.status >= 500);
    }
    const result = sessionEditingDetailsSchema.parse(body);
    if (result.sessionId !== sessionId) throw new Error("Unexpected session");
    return result;
  } catch (error) {
    if (signal?.aborted || error instanceof SessionEditingError) throw error;
    throw new SessionEditingError("UNKNOWN_RESULT", input
      ? "We couldn't confirm the save. Reload the latest details to check the result."
      : "We couldn't load this session. Please try again.", true);
  }
}

function readFailure(body: unknown): { code: string; message: string } | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string"
      && "message" in error && typeof error.message === "string") return { code: error.code, message: error.message };
  }
}

export const sessionEditingTransport: SessionEditingTransport = {
  load: (id, signal) => request(id, undefined, signal), save: (id, input) => request(id, input),
};
