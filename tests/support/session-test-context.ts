import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

/** Test writes are restricted to the separate disposable stack, never the developer stack. */
export function sessionTestEnvironment() {
  const environment = process.env;
  const databaseUrl = environment.SESSION_TEST_DATABASE_URL;
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !databaseUrl ||
    !supabaseUrl ||
    !anonKey ||
    !serviceKey ||
    !environment.SESSION_TEST_STACK_ID?.startsWith("bwm-session-tests-")
  ) {
    throw new Error(
      "Run npm run test:integration or npm run test:e2e:integration to provision the isolated test stack",
    );
  }
  const database = new URL(databaseUrl);
  const api = new URL(supabaseUrl);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !loopback.has(database.hostname) ||
    database.port !== "55322" ||
    database.pathname !== "/postgres" ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.search !== "" ||
    !loopback.has(api.hostname) ||
    api.port !== "55321" ||
    api.protocol !== "http:" ||
    environment.DATABASE_URL !== databaseUrl
  ) {
    throw new Error(
      "Session integration tests require the disposable loopback stack on 55321/55322",
    );
  }
  return { databaseUrl, supabaseUrl, anonKey, serviceKey };
}

export function sessionTestContext() {
  const settings = sessionTestEnvironment();
  const options = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };
  return {
    pool: new Pool({ connectionString: settings.databaseUrl, max: 12 }),
    admin: createClient(settings.supabaseUrl, settings.serviceKey, {
      auth: options,
    }),
    async identity(eligible = true) {
      const email = `session-${randomUUID()}@example.com`;
      const password = `Session-test-${randomUUID()}`;
      const { data, error } = await this.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user)
        throw new Error("Could not provision test identity", { cause: error });
      const userId = data.user.id;
      const wallet = await this.pool.query<{ wallet_id: string }>(
        "select wallet_id from wallets where user_id = $1",
        [userId],
      );
      const walletId = wallet.rows[0]?.wallet_id;
      if (!walletId) throw new Error("Signup did not provision a wallet");
      if (eligible) {
        await this.pool.query(
          `insert into payout_accounts (payout_account_id, user_id, provider_account_reference, bank_account_reference, setup_status)
          values ($1,$2,$3,$4,'COMPLETE')`,
          [
            randomUUID(),
            userId,
            `provider-${randomUUID()}`,
            `bank-${randomUUID()}`,
          ],
        );
      }
      const client = createClient(settings.supabaseUrl, settings.anonKey, {
        auth: options,
      });
      const signedIn = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signedIn.error || !signedIn.data.session)
        throw new Error("Could not sign in test identity", {
          cause: signedIn.error,
        });
      return {
        userId,
        walletId,
        email,
        token: signedIn.data.session.access_token,
      };
    },
  };
}

export type SessionTestContext = ReturnType<typeof sessionTestContext>;
