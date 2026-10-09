import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

/** One join attempt. Reuse the same idempotency key when retrying it (CLAUDE.md rule #6). */
export interface JoinSessionRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly roomToken?: string;
}

export type JoinSessionOutcome =
  | { readonly status: "committed"; readonly heldCents: number }
  | { readonly status: "waitlisted" }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      /**
       * True when the hold may or may not have happened (network failure, any 5xx, or an unreadable
       * reply). The caller must retry with the same idempotency key so the server replays the result.
       */
      readonly unconfirmed: boolean;
    };

export type JoinSession = (request: JoinSessionRequest) => Promise<JoinSessionOutcome>;

export const COMMIT_TO_SESSION_URL = "/api/sessions/commit";

const resultSchema = z.object({
  kind: z.enum(["COMMITTED", "WAITLISTED"]),
  heldCents: z.number().int().safe().nonnegative(),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** What the player is told for each error code the commit route can return. */
export const JOIN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in to join this session.",
  EMAIL_VERIFICATION_REQUIRED: "Confirm your email address before joining sessions.",
  INACTIVE_ACCOUNT: "This account can't join sessions.",
  INSUFFICIENT_FUNDS: "Your wallet doesn't have enough available balance for this share. Top up your wallet, then try again.",
  ALREADY_PARTICIPATING: "You've already joined this session or its waitlist.",
  REJOIN_NOT_ALLOWED: "You withdrew from this session, so you can't join it again.",
  LOW_RELIABILITY: "Your reliability score is below this session's minimum.",
  INVALID_ACCESS: "This session is private. Use the invitation link from the booker.",
  UNAUTHORIZED: "You can't join this session.",
  SESSION_CLOSED: "This session is no longer open for joining.",
  INVALID_STATE: "This session is no longer open for joining.",
  SESSION_STARTED: "This session has already started.",
  NOT_FOUND: "This session no longer exists.",
};

/** A server or network failure: the hold may or may not have happened, so retrying the same request is the safe step. */
export const UNCONFIRMED_JOIN_MESSAGE =
  "We couldn't confirm whether you joined. Try again: the same request is reused, so you won't be charged twice.";

/**
 * UC2-04: asks the server to commit the signed-in player to a session. The server decides
 * between committing and waitlisting and computes the held amount; the browser sends only
 * the session, the retry key and an optional room token.
 */
export const joinSession: JoinSession = async (request) => {
  let token: string | undefined;
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    token = data.session?.access_token;
  } catch {
    return { status: "error", code: "AUTH_UNAVAILABLE", message: "We couldn't check your sign-in. Please try again.", unconfirmed: false };
  }
  if (!token) return { status: "error", code: "UNAUTHENTICATED", message: JOIN_ERROR_MESSAGES.UNAUTHENTICATED!, unconfirmed: false };

  let response: Response;
  let body: unknown;
  try {
    response = await fetch(COMMIT_TO_SESSION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: request.sessionId,
        idempotencyKey: request.idempotencyKey,
        ...(request.roomToken ? { roomToken: request.roomToken } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    body = await response.json();
  } catch {
    return { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_JOIN_MESSAGE, unconfirmed: true };
  }

  if (response.ok) {
    const result = resultSchema.safeParse(body);
    if (!result.success) return { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_JOIN_MESSAGE, unconfirmed: true };
    return result.data.kind === "COMMITTED"
      ? { status: "committed", heldCents: result.data.heldCents }
      : { status: "waitlisted" };
  }

  const failure = errorSchema.safeParse(body);
  const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
  // A server failure never proves that nothing was held, so every 5xx is unconfirmed.
  if (response.status >= 500) return { status: "error", code, message: UNCONFIRMED_JOIN_MESSAGE, unconfirmed: true };
  return { status: "error", code, message: JOIN_ERROR_MESSAGES[code] ?? "We couldn't join this session. Please try again.", unconfirmed: false };
};
