import { accountUpdatedHandler } from "@/app/api/webhooks/payout-account-events";
import {
  createStripeEventVerifier,
  type StripeWebhookDependencies,
} from "@/app/api/webhooks/stripe-webhook";
import { paymentIntentSucceededHandler } from "@/app/api/webhooks/top-up-events";
import { PostgresTopUpCredits } from "@/lib/payments/postgres-top-up-credits";
import { createPayoutServices } from "./payouts";

/**
 * Assembles the Stripe webhook endpoint. Without Stripe test keys, the
 * database, or at least one signing secret, the endpoint answers 503.
 */
export function createStripeWebhookDependencies(): StripeWebhookDependencies | undefined {
  const services = createPayoutServices();
  if (services === undefined || services.stripeSettings.webhookSecrets.length === 0)
    return undefined;
  return {
    verify: createStripeEventVerifier(services.stripe, services.stripeSettings.webhookSecrets),
    handlers: {
      "account.updated": accountUpdatedHandler(services.accounts, services.payoutSetup),
      "payment_intent.succeeded": paymentIntentSucceededHandler(
        new PostgresTopUpCredits(services.getPool),
      ),
    },
  };
}
