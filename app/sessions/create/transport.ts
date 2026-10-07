import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { VenueSearchPage } from "@/lib/venues/contracts";
import type { CreateSessionPayload } from "./model";
import { createSessionSubmissionAction, type SubmitSessionAction } from "../session-actions";

export type CreationOutcome = { status: "created" } | { status: "error"; code: string; message: string; ambiguous: boolean };
export type CreateSession = (payload: CreateSessionPayload) => Promise<CreationOutcome>;
export type SearchVenues = (query: string, page: number, signal: AbortSignal) => Promise<VenueSearchPage>;
const resultSchema = z.object({ sessionId: z.string().min(1), roomToken: z.string().min(1), bookingShareCents: z.number().int().safe().positive() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const messages: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Your sign-in has expired. Sign in again to continue.",
  INACTIVE_ACCOUNT: "This account cannot create sessions. Sign in with an active account.",
  PAYOUT_ACCOUNT_NOT_READY: "Complete your payout account setup before creating a session.",
  INVALID_REQUEST: "Check your booking details and try again.",
  INVALID_INPUT: "Check your booking details and price, then try again.",
  SESSION_STARTED: "The start time has passed. Choose a future booking time.",
  SESSION_API_UNAVAILABLE: "Session creation is temporarily unavailable. Please try again.",
};
async function bearerToken(expectedUserId?: string): Promise<string | undefined> {
  const { data, error } = await createClient().auth.getSession();
  if (error) throw new Error("Authentication is unavailable");
  if (expectedUserId !== undefined && data.session?.user.id !== expectedUserId) return undefined;
  return data.session?.access_token;
}
export async function createSession(payload: CreateSessionPayload, expectedUserId: string, action: SubmitSessionAction = createSessionSubmissionAction): Promise<CreationOutcome> {
  let token: string | undefined;
  try { token = await bearerToken(expectedUserId); } catch {
    return { status: "error", code: "AUTH_UNAVAILABLE", message: "We couldn't verify your sign-in. Please try again.", ambiguous: false };
  }
  if (!token) return { status: "error", code: "UNAUTHENTICATED", message: messages.UNAUTHENTICATED!, ambiguous: false };
  try {
    const response = await fetch(action.href, { method: action.method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ...action.inputs }), signal: AbortSignal.timeout(20_000) });
    const body: unknown = await response.json();
    if (response.ok) { resultSchema.parse(body); return { status: "created" }; }
    const failure = errorSchema.safeParse(body);
    const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
    const ambiguous = response.status >= 500 && code !== "SESSION_API_UNAVAILABLE";
    return { status: "error", code, ambiguous, message: messages[code] ?? (ambiguous
      ? "We couldn't confirm whether your session was created. Retry this submission to check safely."
      : "We couldn't create your session. Please try again.") };
  } catch {
    return { status: "error", code: "UNKNOWN_RESULT", ambiguous: true,
      message: "We couldn't confirm whether your session was created. Retry this submission to check safely." };
  }
}
export const searchVenues: SearchVenues = async (query, page, signal) => {
  const token = await bearerToken();
  if (!token) throw new Error("Sign-in required");
  const response = await fetch(`/api/venues?${new URLSearchParams({ q: query, page: String(page) })}`, {
    headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store",
  });
  if (!response.ok) throw new Error("Venue search unavailable");
  return venuePageSchema.parse(await response.json());
};
const venuePageSchema = z.object({ items: z.array(z.object({ venueName: z.string(), address: z.string(), postalCode: z.string(),
  latitude: z.number().finite(), longitude: z.number().finite(), region: z.enum(["Central", "East", "North", "North-East", "West"]).nullable() })),
  nextPage: z.number().int().positive().nullable() });
