import type Stripe from "stripe";
import { TOP_UP_PURPOSE } from "@/app/api/webhooks/top-up-events";
import type { WalletTopUpProvider, WalletTopUpResult } from "@/use-cases/wallet/contracts";

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
/**
 * Stripe test PayNow QR payloads can contain an HTTPS link to Stripe's hosted
 * success/failure simulator. Never turn an arbitrary QR payload into a clickable
 * URL: live PayNow QR payloads aren't browser links, and URLs must be trusted.
 */
export function stripePayNowTestUrl(rawData: string): string | undefined {
  try {
    const url = new URL(rawData);
    if (url.protocol !== "https:") return undefined;
    if (url.hostname !== "stripe.com" && !url.hostname.endsWith(".stripe.com")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export class StripeWalletTopUps implements WalletTopUpProvider {
  constructor(private readonly stripe: Stripe) {}

  async createIntent(request: TopUpIntentRequest): Promise<WalletTopUpResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: request.amountCents,
        currency: "sgd",
        payment_method_types: ["paynow"],
        // Attach the PayNow method now: Stripe.js confirmPayNowPayment(clientSecret)
        // does not create one, and confirming without it is rejected.
        payment_method_data: { type: "paynow" },
        // Confirm on the server so we can render Stripe's QR in our own modal.
        confirm: true,
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
    const nextAction = intent.next_action;
    if (nextAction?.type !== "paynow_display_qr_code" || !nextAction.paynow_display_qr_code?.image_url_png)
      throw new Error("Stripe did not return a PayNow QR code");
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      currency: "SGD",
      status: intent.status,
      qrCode: {
        imageUrlPng: nextAction.paynow_display_qr_code.image_url_png,
        hostedInstructionsUrl: nextAction.paynow_display_qr_code.hosted_instructions_url ?? undefined,
        // Test-only. This is the URL encoded in Stripe's QR, not an app-side fake.
        testPaymentUrl: stripePayNowTestUrl(nextAction.paynow_display_qr_code.data),
        // Stripe PayNow QR codes expire after one hour.
        expiresAt: (intent.created + 60 * 60) * 1000,
      },
    };
  }
}
