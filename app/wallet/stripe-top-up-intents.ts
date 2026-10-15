import type Stripe from "stripe";
import { TOP_UP_PURPOSE } from "@/app/api/webhooks/top-up-events";
import type { WalletTopUpResult } from "./dependencies";

export interface TopUpIntentRequest {
  readonly userId: string;
  readonly walletId: string;
  readonly amountCents: number;
  /** The client's retry key for this top-up attempt (CLAUDE.md rule #6). */
  readonly idempotencyKey: string;
}

/**
 * Creates a PayNow PaymentIntent for a wallet top-up. Nothing is credited
 * here: the `payment_intent.succeeded` webhook credits the wallet named in
 * the metadata (CLAUDE.md rule #2).
 *
 * Stripe scopes idempotency keys to the platform account, not to the user, so
 * the client's key is prefixed with the user's ID. Otherwise two users who
 * chose the same key would share one PaymentIntent, and the second user's
 * payment would credit the first user's wallet.
 */
export async function createStripeTopUpIntent(
  stripe: Stripe,
  request: TopUpIntentRequest,
): Promise<WalletTopUpResult> {
  const intent = await stripe.paymentIntents.create(
    {
      amount: request.amountCents,
      currency: "sgd",
      payment_method_types: ["paynow"],
      metadata: {
        purpose: TOP_UP_PURPOSE,
        wallet_id: request.walletId,
        user_id: request.userId,
      },
    },
    { idempotencyKey: JSON.stringify(["UC1-05:top-up-intent", request.userId, request.idempotencyKey]) },
  );
  if (intent.client_secret === null)
    throw new Error("Stripe returned a PaymentIntent without a client secret");
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents: intent.amount,
    currency: "SGD",
    status: intent.status,
  };
}
