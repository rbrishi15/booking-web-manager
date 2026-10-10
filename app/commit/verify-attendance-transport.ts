import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

export type AttendanceMark = { readonly participationId: string; readonly attendance: "ATTENDED" | "ABSENT" };

/** One save of attendance marks. Reuse the same idempotency key when retrying it (CLAUDE.md rule #6). */
export interface VerifyAttendanceRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly marks: readonly AttendanceMark[];
}

export type VerifyAttendanceOutcome =
  | { readonly status: "saved"; readonly allVerified: boolean }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      /** True when the marks may or may not have been saved; retry with the same key and marks. */
      readonly unconfirmed: boolean;
    };

export type VerifyAttendance = (request: VerifyAttendanceRequest) => Promise<VerifyAttendanceOutcome>;

export const VERIFY_ATTENDANCE_URL = "/api/sessions/attendance";

const resultSchema = z.object({ sessionId: z.string(), status: z.string() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** What the booker is told for each error code the attendance route can return. */
export const ATTENDANCE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to save attendance.",
  INACTIVE_ACCOUNT: "This account can't manage sessions.",
  UNAUTHORIZED: "Only the session's booker can check attendance.",
  SESSION_NOT_ENDED: "You can check attendance once the session has ended.",
  INVALID_STATE: "Attendance can no longer be changed for this session. Refresh to see the latest list.",
  ATTENDANCE_CONFLICT: "Some players were already marked. Refresh to see the latest attendance.",
  NOT_FOUND: "This session or a player in it no longer exists. Refresh and try again.",
  DUPLICATE_ID: "Each player can be marked only once. Refresh and try again.",
  INVALID_INPUT: "Check the attendance marks and try again.",
};

export const UNCONFIRMED_ATTENDANCE_MESSAGE =
  "We couldn't confirm whether attendance was saved. Try again: the same request is reused, so nothing is recorded twice.";

/**
 * UC2-06: sends the booker's attendance marks. The server checks that the caller is the
 * booker and that the session has ended; the browser sends only the session, the retry key
 * and the marks.
 */
export const verifyAttendance: VerifyAttendance = async (request) => {
  let token: string | undefined;
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    token = data.session?.access_token;
  } catch {
    return { status: "error", code: "AUTH_UNAVAILABLE", message: "We couldn't check your sign-in. Please try again.", unconfirmed: false };
  }
  if (!token) return { status: "error", code: "UNAUTHENTICATED", message: ATTENDANCE_ERROR_MESSAGES.UNAUTHENTICATED!, unconfirmed: false };

  let response: Response;
  let body: unknown;
  try {
    response = await fetch(VERIFY_ATTENDANCE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: request.sessionId, idempotencyKey: request.idempotencyKey, marks: request.marks }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true };
  }
  try {
    body = await response.json();
  } catch {
    // An unreadable body is uncertain only for a success or a server failure; a 4xx is a definite rejection.
    if (response.ok || response.status >= 500) {
      return { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true };
    }
    body = undefined;
  }

  if (response.ok) {
    const result = resultSchema.safeParse(body);
    if (!result.success) return { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true };
    // Every committed player is verified once the session moves on to payout.
    return { status: "saved", allVerified: result.data.status !== "OPEN" };
  }

  const failure = errorSchema.safeParse(body);
  const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
  // A server failure never proves that nothing was saved, so every 5xx is unconfirmed.
  if (response.status >= 500) return { status: "error", code, message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true };
  return { status: "error", code, message: ATTENDANCE_ERROR_MESSAGES[code] ?? "We couldn't save attendance. Please try again.", unconfirmed: false };
};
