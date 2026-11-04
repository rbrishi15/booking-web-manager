"use client";

import { z } from "zod";

export type InvitationLinkOutcome =
  | { readonly status: "ready"; readonly invitationPath: string }
  | { readonly status: "error"; readonly message: string; readonly signIn: boolean };

export type LoadSessionInvitation = (sessionId: string, signal?: AbortSignal) => Promise<InvitationLinkOutcome>;

const responseSchema = z.object({ invitationPath: z.string().min(1) });
const failureSchema = z.object({ error: z.object({ code: z.string() }) });

/** Only a same-origin link for this exact session may be offered for copying. */
function readInvitationPath(body: unknown, sessionId: string): string {
  const { invitationPath } = responseSchema.parse(body);
  const origin = "https://booking.invalid";
  const url = new URL(invitationPath, origin);
  if (!invitationPath.startsWith("/") || invitationPath.startsWith("//")
    || url.origin !== origin || url.pathname !== `/sessions/${encodeURIComponent(sessionId)}/join`
    || url.hash !== "" || url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")) {
    throw new Error("Invalid invitation response");
  }
  return `${url.pathname}${url.search}`;
}

/** Reads the current owner's invitation on demand using the browser's login cookie. */
export const loadSessionInvitation: LoadSessionInvitation = async (sessionId, signal) => {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/invitation`, {
      credentials: "same-origin", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    let body: unknown;
    try { body = await response.json(); }
    catch { if (response.ok) throw new Error("Unreadable invitation response"); }
    if (response.ok) return { status: "ready", invitationPath: readInvitationPath(body, sessionId) };
    const failure = failureSchema.safeParse(body);
    const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
    if (response.status === 401) return { status: "error", signIn: true, message: "Log in again to copy your invitation link." };
    if (response.status === 403) return { status: "error", signIn: false, message: "Only the active session host can copy this invitation." };
    if (response.status === 404 || code === "SESSION_STARTED" || code === "SESSION_CLOSED") {
      return { status: "error", signIn: false, message: "This session is no longer available for invitations." };
    }
  } catch {
    // Transport and server details must not disclose a token or private data.
  }
  return { status: "error", signIn: false, message: "We couldn't load the invitation link. Please try again." };
};
