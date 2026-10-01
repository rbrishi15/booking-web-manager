import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Guard before starting the HTTP server or opening any test connection. */
export function localSupabaseTestEnvironment() {
  const databaseUrl = requiredEnvironment("SESSION_TEST_DATABASE_URL");
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const localStackError =
    "Session tests require the dedicated local Supabase stack on ports 54321/54322";
  let database: URL;
  let supabase: URL;
  try {
    database = new URL(databaseUrl);
    supabase = new URL(supabaseUrl);
  } catch {
    throw new Error(localStackError);
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !loopbackHosts.has(database.hostname) ||
    database.port !== "54322" ||
    database.pathname !== "/postgres" ||
    supabase.protocol !== "http:" ||
    !loopbackHosts.has(supabase.hostname) ||
    supabase.port !== "54321"
  ) {
    throw new Error(localStackError);
  }
  if (requiredEnvironment("DATABASE_URL") !== databaseUrl) {
    throw new Error(
      "DATABASE_URL must match SESSION_TEST_DATABASE_URL for session tests",
    );
  }

  return {
    databaseUrl,
    supabaseUrl,
    anonKey: requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/** Only the dedicated, disposable local Supabase stack can receive test writes. */
export function localSupabaseTestContext() {
  const { databaseUrl, supabaseUrl, anonKey, serviceKey } =
    localSupabaseTestEnvironment();
  const getPool = createPostgresPoolProvider(databaseUrl);
  const authOptions = { persistSession: false, autoRefreshToken: false };
  return {
    pool: getPool(),
    admin: createClient(supabaseUrl, serviceKey, { auth: authOptions }),
    signIn: async (email: string, password: string) => {
      const client = createClient(supabaseUrl, anonKey, { auth: authOptions });
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session)
        throw new Error("Could not sign in the local test user");
      return data.session.access_token;
    },
  };
}

export type LocalSupabaseTestContext = ReturnType<
  typeof localSupabaseTestContext
>;

export async function createTestIdentity(context: LocalSupabaseTestContext) {
  const email = `session-${randomUUID()}@example.com`;
  const password = `Local-test-${randomUUID()}`;
  const { data, error } = await context.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Could not create the local test user");
  const wallet = await context.pool.query<{ wallet_id: string }>(
    "select wallet_id from public.wallets where user_id = $1",
    [data.user.id],
  );
  const walletId = wallet.rows[0]?.wallet_id;
  if (!walletId)
    throw new Error("The signup migration did not create a wallet");
  return { userId: data.user.id, walletId, email, password };
}

export async function prepareEligibleBooker(context: LocalSupabaseTestContext) {
  const identity = await createTestIdentity(context);
  await context.pool.query(
    `insert into public.payout_accounts
       (payout_account_id, user_id, provider_account_reference, bank_account_reference, setup_status)
     values ($1, $2, $3, $4, 'COMPLETE')`,
    [
      randomUUID(),
      identity.userId,
      `provider-${randomUUID()}`,
      `bank-${randomUUID()}`,
    ],
  );
  return identity;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required; run npm run supabase:env first`);
  return value;
}
