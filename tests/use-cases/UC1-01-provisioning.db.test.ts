import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * UC1-01 account provisioning against real Postgres: the sign-up trigger and the
 * 0004 backfill must leave every account with an ACTIVE profile and a wallet whose
 * balance row starts at SGD 0.00 (REQ-5), without touching existing wallets.
 *
 * Skipped unless `PROFILES_TEST_DATABASE_URL` points at a throwaway database.
 * It drops and recreates the `public` schema, so it only runs
 * against a loopback host and a database with "test" in its name. To run it:
 *
 * ```bash
 * npx supabase start
 * psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "create database profiles_test"
 * PROFILES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/profiles_test npm test
 * ```
 */

const DATABASE_URL = process.env.PROFILES_TEST_DATABASE_URL;

/** Migrations that must exist before 0004 runs (wallets come from the ledger migrations). */
const MIGRATIONS_BEFORE_0004 = [
  "0001_wallet_ledger.sql",
  "0002_idempotency_and_reconciliation.sql",
  "0003_ledger_rls.sql",
];

const LEGACY_WITH_WALLET = "00000000-0000-4000-8000-0000000000a1";
const LEGACY_WITHOUT_WALLET = "00000000-0000-4000-8000-0000000000b2";
const NEW_SIGN_UP = "00000000-0000-4000-8000-0000000000c3";
const ODD_METADATA_SIGN_UP = "00000000-0000-4000-8000-0000000000d4";

/** Refuses anything but a local database named for testing, because this suite drops the public schema. */
function requireDisposableDatabase(url: string): string {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!loopback || !databaseName.includes("test")) {
    throw new Error(
      `PROFILES_TEST_DATABASE_URL must be a local database with "test" in its name (got ${parsed.hostname}/${databaseName}).`,
    );
  }
  return url;
}

interface PgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

interface PgModule {
  readonly Client: new (config: { connectionString: string }) => PgClient;
}

// Load the driver only when the opt-in database suite runs.
const DRIVER: string = "pg";

async function runMigration(client: PgClient, file: string): Promise<void> {
  const sql = await readFile(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
  await client.query(sql);
}

async function accountOf(client: PgClient, userId: string) {
  const { rows } = await client.query<{
    account_status: string | null;
    wallet_id: string | null;
    available_cents: string | null;
  }>(
    `select p.account_status, w.wallet_id, b.available_cents::text
       from (select $1::uuid as user_id) as u
       left join public.profiles p on p.user_id = u.user_id
       left join public.wallets w on w.user_id = u.user_id
       left join public.wallet_balances b on b.wallet_id = w.wallet_id`,
    [userId],
  );
  return rows[0];
}

describe.skipIf(!DATABASE_URL)("UC1-01 account provisioning against Postgres", () => {
  let client: PgClient;
  let legacyWalletIdBefore: string;

  beforeAll(async () => {
    const connectionString = requireDisposableDatabase(DATABASE_URL as string);
    const pg = (await import(DRIVER)) as PgModule;
    client = new pg.Client({ connectionString });
    await client.connect();

    // Fresh schemas. A test database has no Supabase Auth, so stand in for the parts 0004 uses.
    await client.query("drop schema if exists public cascade");
    await client.query("drop schema if exists auth cascade");
    await client.query("create schema public");
    await client.query(`
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    for (const migration of MIGRATIONS_BEFORE_0004) await runMigration(client, migration);

    // Two accounts from before 0004: one already has a wallet with S$12.50 in it, one has no wallet.
    await client.query(
      `insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"Alice"}'), ($2, '{"display_name":"Bob"}')`,
      [LEGACY_WITH_WALLET, LEGACY_WITHOUT_WALLET],
    );
    const { rows } = await client.query<{ wallet_id: string }>(
      "insert into public.wallets (user_id) values ($1) returning wallet_id",
      [LEGACY_WITH_WALLET],
    );
    legacyWalletIdBefore = rows[0]!.wallet_id;
    await client.query("update public.wallet_balances set available_cents = 1250 where wallet_id = $1", [
      legacyWalletIdBefore,
    ]);

    await runMigration(client, "0004_profiles.sql");

    // A sign-up after 0004, through the trigger.
    await client.query(
      `insert into auth.users (id, raw_user_meta_data)
       values ($1, '{"display_name":"Cara","preferred_sports":["Tennis"],"preferred_regions":["West"]}')`,
      [NEW_SIGN_UP],
    );
  });

  afterAll(async () => {
    await client?.end();
  });

  test("creates an ACTIVE profile and an S$0.00 wallet for a new sign-up", async () => {
    // Act
    const account = await accountOf(client, NEW_SIGN_UP);

    // Assert
    expect(account).toEqual({ account_status: "ACTIVE", wallet_id: expect.any(String), available_cents: "0" });
  });

  test("gives an older account without a wallet an S$0.00 wallet", async () => {
    // Act
    const account = await accountOf(client, LEGACY_WITHOUT_WALLET);

    // Assert
    expect(account).toEqual({ account_status: "ACTIVE", wallet_id: expect.any(String), available_cents: "0" });
  });

  test("keeps an older account's existing wallet and balance", async () => {
    // Act
    const account = await accountOf(client, LEGACY_WITH_WALLET);

    // Assert
    expect(account).toEqual({ account_status: "ACTIVE", wallet_id: legacyWalletIdBefore, available_cents: "1250" });
  });

  test("signs up an account whose metadata has a too-long name and non-array preferences", async () => {
    // Arrange: metadata the form would never send, but a direct sign-up call could.
    const metadata = { display_name: "x".repeat(80), preferred_sports: "Tennis", preferred_regions: { west: true } };

    // Act
    await client.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)", [
      ODD_METADATA_SIGN_UP,
      JSON.stringify(metadata),
    ]);

    // Assert
    const { rows } = await client.query<{ name_length: number; preferred_sports: string[]; preferred_regions: string[] }>(
      `select char_length(display_name) as name_length, preferred_sports, preferred_regions
         from public.profiles where user_id = $1`,
      [ODD_METADATA_SIGN_UP],
    );
    expect(rows[0]).toEqual({ name_length: 60, preferred_sports: [], preferred_regions: [] });
    expect((await accountOf(client, ODD_METADATA_SIGN_UP))?.available_cents).toBe("0");
  });
});
