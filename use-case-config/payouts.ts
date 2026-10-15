import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type Stripe from "stripe";
import {
  PayoutsUnavailableError,
  type PayoutDependencies,
} from "@/app/payouts/payout-dependencies";
import { createStripeClient, readStripeSettings, type StripeSettings } from "@/app/payouts/stripe-client";
import { StripePayoutAccountProvider } from "@/app/payouts/stripe-payout-account-provider";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresPayoutSetupStore } from "@/lib/payouts/postgres-payout-setup-store";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieSessionAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";
import { SetUpPayoutAccount } from "@/use-cases/payouts/SetUpPayoutAccount";

export interface PayoutServices {
  readonly getPool: () => Pool;
  readonly stripe: Stripe;
  readonly stripeSettings: StripeSettings;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly accounts: StripePayoutAccountProvider;
  readonly payoutSetup: SetUpPayoutAccount;
}

/**
 * Assembles the payout use cases on the session database and Stripe test
 * mode. Missing database or Stripe settings leave payouts unavailable.
 */
export function createPayoutServices(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PayoutServices | undefined {
  const database = readSessionServerSettings(environment);
  const stripeSettings = readStripeSettings(environment);
  if (database === undefined || stripeSettings === undefined) return undefined;
  const getPool = createPostgresPoolProvider(database.databaseUrl);
  const stripe = createStripeClient(stripeSettings.secretKey);
  const accounts = new StripePayoutAccountProvider(stripe);
  return {
    getPool,
    stripe,
    stripeSettings,
    supabaseUrl: database.supabaseUrl,
    supabaseAnonKey: database.supabaseAnonKey,
    accounts,
    payoutSetup: new SetUpPayoutAccount({
      store: new PostgresPayoutSetupStore(getPool, { now: () => new Date() }),
      provider: accounts,
      ids: { next: randomUUID },
    }),
  };
}

/** UC1-07 routes. The status read accepts login cookies; starting setup needs a bearer token. */
export function createPayoutDependencies(): PayoutDependencies {
  const services = createPayoutServices();
  if (services === undefined) {
    const unavailable = async (): Promise<never> => {
      throw new PayoutsUnavailableError();
    };
    return { authenticate: unavailable, payoutSetup: { status: unavailable, start: unavailable } };
  }
  return {
    authenticate: bearerOrLoginCookie(
      createSupabaseSessionAuthenticator(services.supabaseUrl, services.supabaseAnonKey),
      createSupabaseCookieSessionAuthenticator(services.supabaseUrl, services.supabaseAnonKey),
    ),
    payoutSetup: services.payoutSetup,
  };
}
