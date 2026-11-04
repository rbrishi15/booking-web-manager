import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

export const TOP_UP_URL = "/api/wallet/top-up";

export interface PayNowSession {
  readonly clientSecret: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly qrCode: {
    readonly imageUrlPng: string;
    readonly hostedInstructionsUrl?: string;
    readonly testPaymentUrl?: string;
    readonly expiresAt: number;
  };
}

export type StartTopUpOutcome =
  | { readonly status: "ready"; readonly session: PayNowSession }
  | { readonly status: "error"; readonly message: string };

export type PaymentStatus =
  | { readonly status: "pending" }
  | { readonly status: "paid" }
  | { readonly status: "expired" }
  | { readonly status: "error"; readonly message: string };

export interface TopUpTransport {
  /** Starts one Stripe PayNow payment. Never opens Stripe's overlay. */
  readonly startPayNow: (amountCents: number, idempotencyKey: string) => Promise<StartTopUpOutcome>;
  /** Read-only check; wallet credits are still exclusively webhook driven. */
  readonly checkPayment: (session: PayNowSession) => Promise<PaymentStatus>;
}

const intentSchema = z.object({
  paymentIntentId: z.string().min(1),
  clientSecret: z.string().min(1),
  amountCents: z.number().int().positive(),
  qrCode: z.object({
    imageUrlPng: z.string().url(),
    hostedInstructionsUrl: z.string().url().optional(),
    testPaymentUrl: z.string().url().optional(),
    expiresAt: z.number().int().positive(),
  }),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to top up.",
  INACTIVE_ACCOUNT: "This account can't top up.",
  TOP_UP_UNAVAILABLE: "Top-ups aren't available yet. Please try again later.",
};
const FALLBACK = "We couldn't start the top-up. Please try again.";

/** The application intentionally only supports Stripe test mode. */
export function readPublishableKey(value = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY): string | undefined {
  const key = value?.trim();
  return key?.startsWith("pk_test_") ? key : undefined;
}

export function createTopUpTransport(publishableKey: string): TopUpTransport {
  let stripe: Promise<StripeJs | null> | undefined;
  const getStripe = () => (stripe ??= loadStripe(publishableKey));

  return {
    async startPayNow(amountCents, idempotencyKey) {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return { status: "error", message: ERROR_MESSAGES.UNAUTHENTICATED! };
        const response = await fetch(TOP_UP_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents, idempotencyKey }),
          signal: AbortSignal.timeout(20_000),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const failure = errorSchema.safeParse(body);
          const code = failure.success ? failure.data.error.code : "";
          return { status: "error", message: ERROR_MESSAGES[code] ?? FALLBACK };
        }
        const parsed = intentSchema.safeParse(body);
        if (!parsed.success) return { status: "error", message: "Stripe did not return a usable QR code." };
        return { status: "ready", session: parsed.data };
      } catch {
        return { status: "error", message: FALLBACK };
      }
    },
    async checkPayment(session) {
      try {
        const client = await getStripe();
        if (!client) return { status: "error", message: "Stripe couldn't load. We'll keep checking." };
        const result = await client.retrievePaymentIntent(session.clientSecret);
        if (result.error) {
          return { status: "error", message: result.error.message ?? "Couldn't check payment status." };
        }
        switch (result.paymentIntent.status) {
          case "succeeded":
            return { status: "paid" };
          case "canceled":
          case "requires_payment_method":
            return { status: "expired" };
          default:
            return { status: "pending" };
        }
      } catch {
        return { status: "error", message: "Couldn't check payment status. You can still complete the payment." };
      }
    },
  };
}
