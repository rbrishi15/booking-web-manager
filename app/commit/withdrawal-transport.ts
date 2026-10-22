import { z } from "zod";
import { actionFailure, sendAsSignedInUser, type SentRequest } from "./session-action-request";
import type { JoinedSessionItem, LeaveWaitlist, LoadJoinedSessions, PreviewWithdrawal, WithdrawFromSession } from "./withdrawal-ports";

/**
 * UC2-05 production adapters. Each one calls an existing API, validates the reply with Zod, and
 * maps it explicitly to the presentation contract in `withdrawal-ports.ts`:
 *
 * | API reply | Presentation result |
 * | --- | --- |
 * | GET /api/sessions/joined `{ sessions: [{ sessionId, venueName, sport, region, startAt, endAt, status, bookingShareCents }] }` | `JoinedSessionItem[]` (same fields) |
 * | GET /api/sessions/{sessionId}/withdrawal-preview `{ kind, refundCents, heldCents, … }` | `{ status: "ready", preview: { kind, refundCents, heldCents } }` |
 * | POST /api/sessions/withdraw `{ kind, refundedCents, promotion, … }` | `{ status: "withdrawn", kind, refundedCents }` |
 * | POST /api/sessions/waitlist/leave `{ sessionId, participationId, promotion }` | `{ status: "left" }` |
 *
 * Fields the screens do not use (participation IDs, promotion results) are validated but dropped.
 */
export const withdrawalPreviewUrl = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/withdrawal-preview`;
export const JOINED_SESSIONS_URL = "/api/sessions/joined";
export const WITHDRAW_URL = "/api/sessions/withdraw";
export const LEAVE_WAITLIST_URL = "/api/sessions/waitlist/leave";

const cents = z.number().int().safe().nonnegative();
const kind = z.enum(["REFUNDED", "AWAITING_REPLACEMENT"]);
const previewResponseSchema = z.object({ sessionId: z.string(), participationId: z.string(), kind, refundCents: cents, heldCents: cents });
const withdrawResponseSchema = z.object({ sessionId: z.string(), participationId: z.string(), kind, refundedCents: cents });
const leaveResponseSchema = z.object({ sessionId: z.string(), participationId: z.string() });
const joinedResponseSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string(), venueName: z.string(), sport: z.string(), region: z.string(),
    startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }),
    status: z.enum(["COMMITTED", "WAITLISTED"]), bookingShareCents: cents,
  })),
});

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

const send = (url: string, init: RequestInit, unconfirmed: string) =>
  sendAsSignedInUser(url, init, { unconfirmed, signedOut: WITHDRAWAL_ERROR_MESSAGES.UNAUTHENTICATED! });
const failure = (sent: Extract<SentRequest, { status: "sent" }>, unconfirmed: string, fallback: string) =>
  actionFailure(sent, { unconfirmed, byCode: WITHDRAWAL_ERROR_MESSAGES, fallback });

export const JOINED_SESSIONS_LOAD_MESSAGE = "We couldn't load your sessions. Check your connection and try again.";

/**
 * UC2-05: the player's places, for React Query. Throws when the list cannot be loaded, including a
 * malformed reply, so a missing place is never mistaken for one that has gone.
 */
export const loadJoinedSessions: LoadJoinedSessions = async () => {
  const sent = await send(JOINED_SESSIONS_URL, { method: "GET" }, JOINED_SESSIONS_LOAD_MESSAGE);
  if (sent.status === "error") throw new Error(sent.unconfirmed ? JOINED_SESSIONS_LOAD_MESSAGE : sent.message);
  if (sent.response.ok) {
    const parsed = joinedResponseSchema.safeParse(sent.body);
    if (parsed.success) return parsed.data.sessions.map((session): JoinedSessionItem => ({
      sessionId: session.sessionId, venueName: session.venueName, sport: session.sport, region: session.region,
      startAt: session.startAt, endAt: session.endAt, status: session.status, bookingShareCents: session.bookingShareCents,
    }));
    throw new Error(JOINED_SESSIONS_LOAD_MESSAGE);
  }
  throw new Error(failure(sent, JOINED_SESSIONS_LOAD_MESSAGE, JOINED_SESSIONS_LOAD_MESSAGE).message);
};

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
