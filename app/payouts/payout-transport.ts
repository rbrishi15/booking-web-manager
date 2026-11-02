import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const setupSchema = z.object({
  status: z.enum(["NOT_STARTED", "PENDING", "COMPLETE", "FAILED"]),
  onboardingUrl: z.string().url().optional(),
  instantPayoutsAvailable: z.boolean().optional(),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const sessionsSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string(),
      venueName: z.string(),
      sport: z.string(),
      startAt: z.string().datetime({ offset: true }),
      status: z.enum(["AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"]),
      amountCents: z.number().int().safe().nonnegative(),
    }),
  ),
});
const withdrawalSchema = z.object({
  kind: z.enum(["PAID", "NOTHING_TO_PAY", "DECLINED"]),
  amountCents: z.number().int().safe().positive().optional(),
  bankPayout: z.enum(["STANDARD", "INSTANT"]).optional(),
  /** Stripe's decline code, present when kind is DECLINED. */
  reason: z.string().optional(),
});

/** What a booker should know about a decline: no money moved, and what to do next. */
export function declinedWithdrawalMessage(reason: string | undefined): string {
  if (reason === "balance_insufficient")
    return "Players' PayNow payments are still settling with Stripe, so this payout can't be sent yet. No money moved. Please try again in a day or two.";
  return "Stripe couldn't send this payout, and no money moved. Please try again later.";
}

export type PayoutSetup = z.infer<typeof setupSchema>;
export type PayoutSetupStatus = PayoutSetup["status"];
export type SessionPayout = z.infer<typeof sessionsSchema>["items"][number];
export type Withdrawal = z.infer<typeof withdrawalSchema>;
export type WithdrawalMethod = "STANDARD" | "INSTANT";

/** A withdrawal answer, or whether retrying with the same key is the safe next step. */
export type WithdrawalLoad =
  | { readonly status: "ready"; readonly data: Withdrawal }
  | { readonly status: "error"; readonly message: string; readonly retrySameKey: boolean };

export type PayoutLoad =
  | { readonly status: "ready"; readonly data: PayoutSetup }
  | { readonly status: "error"; readonly code: string; readonly message: string };

export interface PayoutTransport {
  readonly load: () => Promise<PayoutLoad>;
  /** Starts or resumes Stripe onboarding; a ready result carries the onboarding link. */
  readonly start: () => Promise<PayoutLoad>;
  readonly loadSessions: () => Promise<
    | { readonly status: "ready"; readonly data: readonly SessionPayout[] }
    | { readonly status: "error"; readonly message: string }
  >;
  readonly withdraw: (
    sessionId: string,
    idempotencyKey: string,
    method: WithdrawalMethod,
  ) => Promise<WithdrawalLoad>;
}

export const PAYOUT_ACCOUNT_URL = "/api/payouts/account";
export const SESSION_PAYOUTS_URL = "/api/payouts/sessions";
export const WITHDRAW_URL = "/api/payouts/withdraw";

const WITHDRAW_MESSAGES: Readonly<Record<string, string>> = {
  ATTENDANCE_INCOMPLETE: "Verify every participant's attendance before withdrawing.",
  PAYOUT_ACCOUNT_NOT_READY: "Finish setting up your payout account first.",
  SESSION_CLOSED: "This session has already been paid out.",
  UNAUTHORIZED: "Only the session's booker can withdraw its payout.",
};
const UNCLEAR_WITHDRAWAL =
  "We couldn't confirm the withdrawal. Try again: the same request is reused, so you won't be paid twice.";

export const PAYOUT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to set up payouts.",
  INACTIVE_ACCOUNT: "This account can't receive payouts.",
  PAYOUTS_UNAVAILABLE: "Payouts aren't available yet. Please try again later.",
  PAYOUT_PROVIDER_UNAVAILABLE: "We couldn't reach Stripe. Please try again.",
  NETWORK_ERROR: "We couldn't reach the server. Check your connection and try again.",
};
const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

async function send(
  url: string,
  method: "GET" | "POST",
  json?: object,
): Promise<{ readonly response: Response; readonly body: unknown } | null> {
  let token: string | undefined;
  try {
    const { data } = await createClient().auth.getSession();
    token = data.session?.access_token;
  } catch {
    // Fall through: the server answers 401 and the page offers Log in.
  }
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    return { response, body: await response.json() };
  } catch {
    return null;
  }
}

function errorCode(body: unknown): string {
  const failure = errorSchema.safeParse(body);
  return failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
}

async function request(method: "GET" | "POST"): Promise<PayoutLoad> {
  const sent = await send(PAYOUT_ACCOUNT_URL, method);
  if (sent === null)
    return { status: "error", code: "NETWORK_ERROR", message: PAYOUT_ERROR_MESSAGES.NETWORK_ERROR! };
  const { response, body } = sent;
  if (response.ok) {
    const parsed = setupSchema.safeParse(body);
    return parsed.success
      ? { status: "ready", data: parsed.data }
      : { status: "error", code: "UNEXPECTED_RESPONSE", message: FALLBACK_MESSAGE };
  }
  const code = errorCode(body);
  return { status: "error", code, message: PAYOUT_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE };
}

export const payoutTransport: PayoutTransport = {
  load: () => request("GET"),
  start: () => request("POST"),

  async loadSessions() {
    const sent = await send(SESSION_PAYOUTS_URL, "GET");
    if (sent === null) return { status: "error", message: PAYOUT_ERROR_MESSAGES.NETWORK_ERROR! };
    const parsed = sent.response.ok ? sessionsSchema.safeParse(sent.body) : undefined;
    if (parsed?.success) return { status: "ready", data: parsed.data.items };
    return { status: "error", message: PAYOUT_ERROR_MESSAGES[errorCode(sent.body)] ?? FALLBACK_MESSAGE };
  },

  async withdraw(sessionId, idempotencyKey, method) {
    const sent = await send(WITHDRAW_URL, "POST", { sessionId, idempotencyKey, method });
    // A lost response or any 5xx never proves nothing was paid: retry with the same key.
    if (sent === null || sent.response.status >= 500)
      return { status: "error", message: UNCLEAR_WITHDRAWAL, retrySameKey: true };
    if (sent.response.ok) {
      const parsed = withdrawalSchema.safeParse(sent.body);
      return parsed.success
        ? { status: "ready", data: parsed.data }
        : { status: "error", message: UNCLEAR_WITHDRAWAL, retrySameKey: true };
    }
    const code = errorCode(sent.body);
    return {
      status: "error",
      message: WITHDRAW_MESSAGES[code] ?? PAYOUT_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE,
      retrySameKey: false,
    };
  },
};
