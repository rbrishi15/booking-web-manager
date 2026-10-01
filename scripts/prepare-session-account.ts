import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const accountFile = ".env.session-account.local";
if (existsSync(accountFile)) process.loadEnvFile(accountFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Run npm run supabase:env first.`);
  return value;
}

const apiUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const databaseUrl = required("DATABASE_URL");
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (
  !loopback.has(new URL(apiUrl).hostname) ||
  !loopback.has(new URL(databaseUrl).hostname) ||
  new URL(databaseUrl).port !== "54322"
) {
  throw new Error("Account preparation is restricted to local Supabase on port 54322.");
}

async function main(): Promise<void> {
  const email = process.env.SESSION_DEV_EMAIL ?? "session-booker@local.example";
  const password = process.env.SESSION_DEV_PASSWORD ?? randomBytes(24).toString("base64url");
  const admin = createClient(apiUrl, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = createClient(apiUrl, required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = await auth.auth.signInWithPassword({ email, password });
  let userId = existing.data.user?.id;
  if (!userId) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Local session booker" },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  }

  // Save access credentials before the SQL step so a failed setup is retryable.
  writeFileSync(accountFile, [
    "# LOCAL DEVELOPMENT ONLY. Payout references below are not verified Stripe accounts.",
    `SESSION_DEV_EMAIL=${JSON.stringify(email)}`,
    `SESSION_DEV_PASSWORD=${JSON.stringify(password)}`,
    "",
  ].join("\n"), { mode: 0o600 });

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const account = await pool.query(
      "select p.user_id from profiles p join wallets w using (user_id) where p.user_id = $1",
      [userId],
    );
    if (account.rowCount !== 1) {
      throw new Error("The registration migration did not provision a profile and wallet.");
    }
    await pool.query(
      `insert into payout_accounts
         (payout_account_id, user_id, provider_account_reference, bank_account_reference, setup_status)
       values ($1, $2, $3, $4, 'COMPLETE') on conflict (user_id) do nothing`,
      [randomUUID(), userId, `local-dev-provider-${userId}`, `local-dev-bank-${userId}`],
    );
  } finally {
    await pool.end();
  }

  console.log(`Prepared local account ${email}. Credentials are in ${accountFile}.`);
  console.log("Payout references are development fixtures; no Stripe onboarding or payments were performed.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local account preparation failed.");
  process.exitCode = 1;
});
