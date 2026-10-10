import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { ActionError, LeaveWaitlist, PreviewWithdrawal, WithdrawFromSession } from "./withdrawal-ports";

/**
 * UC2-05 production adapters. Each one calls an existing API, validates the reply with Zod, and
 * maps it explicitly to the presentation contract in `withdrawal-ports.ts`:
 *
 * | API reply | Presentation result |
 * | --- | --- |
 * | GET /api/sessions/{sessionId}/withdrawal-preview `{ kind, refundCents, heldCents, … }` | `{ status: "ready", preview: { kind, refundCents, heldCents } }` |
 * | POST /api/sessions/withdraw `{ kind, refundedCents, promotion, … }` | `{ status: "withdrawn", kind, refundedCents }` |
 * | POST /api/sessions/waitlist/leave `{ sessionId, participationId, promotion }` | `{ status: "left" }` |
 *
 * Fields the screens do not use (participation IDs, promotion results) are validated but dropped.
 */
export const withdrawalPreviewUrl = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/withdrawal-preview`;
export const WITHDRAW_URL = "/api/sessions/withdraw";
export const LEAVE_WAITLIST_URL = "/api/sessions/waitlist/leave";

const cents = z.number().int().safe().nonnegative();
const kind = z.enum(["REFUNDED", "AWAITING_REPLACEMENT"]);
const previewResponseSchema = z.object({ sessionId: z.string(), participationId: z.string(), kind, refundCents: cents, heldCents: cents });
const withdrawResponseSchema = z.object({ sessionId: z.string(), participationId: z.string(), kind, refundedCents: cents });
const leaveResponseSchema = z.object({ sessionId: z.string(), participationId: z.string() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** What the player is told for each error code these routes can return. */
export const WITHDRAWAL_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to manage your sessions.",
  INACTIVE_ACCOUNT: "This account can't manage sessions.",
  UNAUTHORIZED: "You can't change this place.",
  NOT_FOUND: "This session or your place in it no longer exists. Refresh to see your sessions.",
  INVALID_STATE: "Your place has already changed. Refresh to see your sessions.",
  SESSION_STARTED: "This session has already started, so you can't withdraw.",
  SESSION_CLOSED: "This session is closed, so you can't withdraw.",
  INVALID_INVITATION: "That person can't be invited to take your place. Choose someone else or open it to the waitlist.",
  INVALID_INPUT: "Check your choice and try again.",
  SESSION_MANAGEMENT_UNAVAILABLE: "Sessions are temporarily unavailable. Please try again later.",
};

export const UNCONFIRMED_WITHDRAWAL_MESSAGE =
  "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.";
export const UNCONFIRMED_LEAVE_MESSAGE =
  "We couldn't confirm whether you left the waitlist. Try again: the same request is reused, so nothing happens twice.";

type Sent = { readonly status: "sent"; readonly response: Response; readonly body: unknown } | ActionError;

/** Sends one request as the signed-in user. A network failure is unconfirmed: it may have reached the server. */
async function send(url: string, init: RequestInit, unconfirmedMessage: string): Promise<Sent> {
  let token: string | undefined;
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    token = data.session?.access_token;
  } catch {
    return { status: "error", code: "AUTH_UNAVAILABLE", message: "We couldn't check your sign-in. Please try again.", unconfirmed: false };
  }
  if (!token) return { status: "error", code: "UNAUTHENTICATED", message: WITHDRAWAL_ERROR_MESSAGES.UNAUTHENTICATED!, unconfirmed: false };

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { status: "error", code: "UNKNOWN_RESULT", message: unconfirmedMessage, unconfirmed: true };
  }
  try {
    return { status: "sent", response, body: await response.json() };
  } catch {
    return { status: "sent", response, body: undefined };
  }
}

/** Maps a failure reply: a 5xx, 408, 429 or unreadable reply never proves nothing happened; other 4xx are definite rejections. */
function failure(sent: Extract<Sent, { status: "sent" }>, unconfirmedMessage: string, fallback: string): ActionError {
  const parsed = errorSchema.safeParse(sent.body);
  const code = parsed.success ? parsed.data.error.code : "UNEXPECTED_ERROR";
  // 408 and 429 can come from a proxy after the request already reached the server.
  if (sent.response.ok || sent.response.status >= 500 || sent.response.status === 408 || sent.response.status === 429) {
    return { status: "error", code, message: unconfirmedMessage, unconfirmed: true };
  }
  return { status: "error", code, message: WITHDRAWAL_ERROR_MESSAGES[code] ?? fallback, unconfirmed: false };
}

/** UC2-05: what withdrawing now would refund. Read-only; nothing is saved. */
export const previewWithdrawal: PreviewWithdrawal = async (sessionId) => {
  const sent = await send(withdrawalPreviewUrl(sessionId), { method: "GET" }, "We couldn't check your refund. Please try again.");
  if (sent.status === "error") return { status: "error", message: sent.unconfirmed ? "We couldn't check your refund. Please try again." : sent.message };
  if (sent.response.ok) {
    const parsed = previewResponseSchema.safeParse(sent.body);
    if (parsed.success) return { status: "ready", preview: { kind: parsed.data.kind, refundCents: parsed.data.refundCents, heldCents: parsed.data.heldCents } };
    return { status: "error", message: "We couldn't check your refund. Please try again." };
  }
  return { status: "error", message: failure(sent, "We couldn't check your refund. Please try again.", "We couldn't check your refund. Please try again.").message };
};

/** UC2-05: withdraws with the player's choice of who gets the place. The server decides the refund. */
export const withdrawFromSession: WithdrawFromSession = async (request) => {
  const sent = await send(WITHDRAW_URL, {
    method: "POST",
    body: JSON.stringify({ sessionId: request.sessionId, idempotencyKey: request.idempotencyKey, replacement: request.replacement }),
  }, UNCONFIRMED_WITHDRAWAL_MESSAGE);
  if (sent.status === "error") return sent;
  if (sent.response.ok) {
    const parsed = withdrawResponseSchema.safeParse(sent.body);
    if (parsed.success) return { status: "withdrawn", kind: parsed.data.kind, refundedCents: parsed.data.refundedCents };
  }
  return failure(sent, UNCONFIRMED_WITHDRAWAL_MESSAGE, "We couldn't withdraw you. Please try again.");
};

/** UC2-05: leaves the waitlist. No money moves. */
export const leaveWaitlist: LeaveWaitlist = async (request) => {
  const sent = await send(LEAVE_WAITLIST_URL, {
    method: "POST",
    body: JSON.stringify({ sessionId: request.sessionId, idempotencyKey: request.idempotencyKey }),
  }, UNCONFIRMED_LEAVE_MESSAGE);
  if (sent.status === "error") return sent;
  if (sent.response.ok && leaveResponseSchema.safeParse(sent.body).success) return { status: "left" };
  return failure(sent, UNCONFIRMED_LEAVE_MESSAGE, "We couldn't take you off the waitlist. Please try again.");
};
