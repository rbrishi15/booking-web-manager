"use client";

import { z } from "zod";
import { hostedSessionsResponseSchema, type HostedSessionsResponse } from "./hosted-sessions-contract";

export const HOSTED_SESSIONS_URL = "/api/sessions/hosted";

const failureSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
/** The error code to assume when a failure reply has no readable code. */
const statusCodes: Readonly<Record<number, string>> = { 401: "UNAUTHENTICATED", 503: "SESSION_MANAGEMENT_UNAVAILABLE" };

/** A failed hosted-sessions read; `signIn` means the user must log in again. */
export class HostedSessionsLoadError extends Error {
  constructor(readonly code: string, readonly kind: "unavailable" | "unexpected", readonly signIn: boolean) {
    super(code);
    this.name = "HostedSessionsLoadError";
  }
}

/** `signal` cancels a request React Query no longer needs. */
export type LoadHostedSessions = (signal?: AbortSignal) => Promise<HostedSessionsResponse>;

/**
 * UC2-03 / UC2-06: reads the signed-in booker's hosted sessions from GET /api/sessions/hosted.
 * The browser sends its login cookies with this same-origin request; the API checks them.
 */
export const loadHostedSessions: LoadHostedSessions = async (signal) => {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(20_000);
    response = await fetch(HOSTED_SESSIONS_URL, {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new HostedSessionsLoadError("NETWORK_ERROR", "unexpected", false);
  }
  // An unreadable success is unusable; an unreadable failure still has its status.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new HostedSessionsLoadError("NETWORK_ERROR", "unexpected", false);
  }
  if (response.ok) {
    const parsed = hostedSessionsResponseSchema.safeParse(body);
    if (!parsed.success) throw new HostedSessionsLoadError("UNEXPECTED_RESPONSE", "unexpected", false);
    return parsed.data;
  }
  const failure = failureSchema.safeParse(body);
  const code = failure.success ? failure.data.error.code : statusCodes[response.status] ?? "UNEXPECTED_ERROR";
  const signIn = code === "UNAUTHENTICATED" || code === "INACTIVE_ACCOUNT" || code === "NOT_FOUND";
  throw new HostedSessionsLoadError(code, code === "SESSION_MANAGEMENT_UNAVAILABLE" ? "unavailable" : "unexpected", signIn);
};
