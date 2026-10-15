import type { TopUpEvent, TopUpPayment } from "@/lib/payments/postgres-top-up-credits";
import type { StripeEventHandler } from "./stripe-webhook";

export interface TopUpCredits {
  credit(event: TopUpEvent, payment: TopUpPayment): Promise<unknown>;
}

/** Marks PaymentIntents created by POST /api/wallet/top-up. */
export const TOP_UP_PURPOSE = "wallet_top_up";

/**
 * UC1-05 top-up crediting (CLAUDE.md rule #2): only this verified webhook
 * credits a wallet, never the browser's success callback, so a user who closes
 * the tab still gets their money. The wallet comes from metadata this server
 * set when it created the PaymentIntent, and the amount is what Stripe
 * actually received, in integer cents.
 */
export function paymentIntentSucceededHandler(credits: TopUpCredits): StripeEventHandler {
  return async (event) => {
    if (event.type !== "payment_intent.succeeded") return;
    const intent = event.data.object;
    const walletId = intent.metadata?.wallet_id;
    // Other PaymentIntents on the account are not wallet top-ups.
    if (intent.metadata?.purpose !== TOP_UP_PURPOSE || !walletId) return;

    const amountCents = intent.amount_received;
    if (intent.currency !== "sgd" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      // Acknowledged rather than retried forever; needs a person to look at it.
      console.error("Stripe top-up cannot be credited automatically", intent.id, intent.currency, amountCents);
      return;
    }

    await credits.credit(
      { eventId: event.id, eventType: event.type },
      {
        paymentReference: intent.id,
        walletId,
        amountCents,
        succeededAt: new Date(event.created * 1000),
      },
    );
  };
}
