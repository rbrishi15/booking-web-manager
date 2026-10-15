import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

export const TOP_UP_URL = "/api/wallet/top-up";

/** How one top-up attempt ended, from the browser's point of view. */
export type TopUpOutcome =
  /** Stripe has the money; the webhook credits the wallet moments later. */
  | { readonly status: "paid" }
  | { readonly status: "cancelled" }
  | { readonly status: "error"; readonly message: string };

export interface TopUpTransport {
  /** Creates the PaymentIntent and shows Stripe's PayNow QR code until the payment ends. */
  readonly payWithPayNow: (amountCents: number, idempotencyKey: string) => Promise<TopUpOutcome>;
}

const intentSchema = z.object({ clientSecret: z.string().min(1) });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to top up.",
  INACTIVE_ACCOUNT: "This account can't top up.",
  TOP_UP_UNAVAILABLE: "Top-ups aren't available yet. Please try again later.",
};
const FALLBACK = "We couldn't start the top-up. Please try again.";

/** A test-mode publishable key, or undefined to hide top-ups. Live payments are out of scope. */
export function readPublishableKey(value = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY): string | undefined {
  const key = value?.trim();
  return key?.startsWith("pk_test_") ? key : undefined;
}

export function createTopUpTransport(publishableKey: string): TopUpTransport {
  let stripe: Promise<StripeJs | null> | undefined;
  return {
    async payWithPayNow(amountCents, idempotencyKey) {
      let clientSecret: string;
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
        const intent = intentSchema.safeParse(body);
        if (!intent.success) return { status: "error", message: FALLBACK };
        clientSecret = intent.data.clientSecret;
      } catch {
        return { status: "error", message: FALLBACK };
      }

      stripe ??= loadStripe(publishableKey);
      const client = await stripe;
      if (client === null) return { status: "error", message: "Stripe couldn't load. Please try again." };
      const result = await client.confirmPayNowPayment(clientSecret);
      if (result.error) return { status: "error", message: result.error.message ?? FALLBACK };
      return result.paymentIntent.status === "succeeded" ? { status: "paid" } : { status: "cancelled" };
    },
  };
}
