"use client";

import { z } from "zod";
import { fetchAsSignedInUser, SignInUnavailableError } from "@/lib/supabase/authorized-fetch";
import { hostedSessionsResponseSchema, type HostedSessionsResponse } from "./hosted-sessions-response";

export const HOSTED_SESSIONS_URL = "/api/sessions/hosted";

const failureSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** A failed hosted-sessions read; `signIn` means the user must log in again. */
export class HostedSessionsLoadError extends Error {
  constructor(readonly code: string, readonly kind: "unavailable" | "unexpected", readonly signIn: boolean) {
    super(code);
    this.name = "HostedSessionsLoadError";
  }
}

export type LoadHostedSessions = () => Promise<HostedSessionsResponse>;

/** UC2-03 / UC2-06: reads the signed-in booker's hosted sessions from GET /api/sessions/hosted. */
export const loadHostedSessions: LoadHostedSessions = async () => {
  let response: Response | null;
  let body: unknown;
  try {
    response = await fetchAsSignedInUser(HOSTED_SESSIONS_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response === null) throw new HostedSessionsLoadError("UNAUTHENTICATED", "unexpected", true);
    body = await response.json();
  } catch (error) {
    if (error instanceof HostedSessionsLoadError) throw error;
    if (error instanceof SignInUnavailableError) throw new HostedSessionsLoadError("AUTH_UNAVAILABLE", "unexpected", false);
    throw new HostedSessionsLoadError("NETWORK_ERROR", "unexpected", false);
  }
  if (response.ok) {
    const parsed = hostedSessionsResponseSchema.safeParse(body);
    if (!parsed.success) throw new HostedSessionsLoadError("UNEXPECTED_RESPONSE", "unexpected", false);
    return parsed.data as HostedSessionsResponse;
  }
  const failure = failureSchema.safeParse(body);
  const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
  const signIn = code === "UNAUTHENTICATED" || code === "INACTIVE_ACCOUNT" || code === "NOT_FOUND";
  throw new HostedSessionsLoadError(code, code === "SESSION_MANAGEMENT_UNAVAILABLE" ? "unavailable" : "unexpected", signIn);
};
