import { createStripeClient, readStripeSettings } from "@/app/payouts/stripe-client";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { StripeWalletTopUps } from "@/app/wallet/stripe-top-up-intents";
import { TopUpUnavailableError, WalletApiUnavailableError } from "@/app/wallet/wallet-api-unavailable";
import type { WalletApiDependencies } from "@/app/wallet/dependencies";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { createPostgresExecutor } from "@/lib/database/postgres-executor";
import { PostgresWalletReader } from "@/lib/wallet/postgres-wallet-reader";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieSessionAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";
import { GetWalletSummary } from "@/use-cases/wallet/GetWalletSummary";
import { ListWalletTransactions } from "@/use-cases/wallet/ListWalletTransactions";
import { CreateWalletTopUp } from "@/use-cases/wallet/CreateWalletTopUp";

/** Assemble stateless wallet workflows; adapters own SQL and provider calls. */
export function createWalletDependencies(): WalletApiDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => { throw new WalletApiUnavailableError(); };
    return {
      authenticate: unavailable,
      walletSummary: { forUser: unavailable },
      walletTransactions: { forUser: unavailable },
      walletTopUp: { forUser: unavailable },
    };
  }

  const reader = new PostgresWalletReader(
    createPostgresExecutor(createPostgresPoolProvider(settings.databaseUrl)),
  );
  const stripeSettings = readStripeSettings();
  return {
    authenticate: bearerOrLoginCookie(
      createSupabaseSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
      createSupabaseCookieSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    ),
    walletSummary: new GetWalletSummary(reader),
    walletTransactions: new ListWalletTransactions(reader),
    walletTopUp: stripeSettings
      ? new CreateWalletTopUp(reader, new StripeWalletTopUps(createStripeClient(stripeSettings.secretKey)))
      : { forUser: async () => { throw new TopUpUnavailableError(); } },
  };
}
