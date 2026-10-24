import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * UC1-01 / UC1-03 user IDs (ADR-0021) against real Postgres: existing accounts get an ID
 * made from their name; the sign-up trigger keeps a valid, free ID; every ACTIVE account
 * keeps one; update_profile sets, keeps or refuses IDs.
 *
 * Skipped unless `USER_HANDLES_TEST_DATABASE_URL` points at a throwaway database, because CI has
 * no Postgres. It drops and recreates the `public` schema, so it only runs against a loopback
 * host and a database with "test" in its name. Set up as in UC1-01-provisioning.db.test.ts, using its own database.
 */

const DATABASE_URL = process.env.USER_HANDLES_TEST_DATABASE_URL;

const MIGRATIONS_BEFORE_0016 = [
  "0001_wallet_ledger.sql",
  "0002_idempotency_and_reconciliation.sql",
  "0003_ledger_rls.sql",
  "0004_profiles.sql",
  "0011_profile_policy_guards.sql",
];

// Accounts from before 0016.
const OLD_MARCUS = "00000000-0000-4000-8000-000000000001";
const OLD_MARCUS_TWIN = "00000000-0000-4000-8000-000000000002";
const OLD_NON_LATIN = "00000000-0000-4000-8000-000000000003";
const OLD_UNNAMED = "00000000-0000-4000-8000-000000000004";
const OLD_DELETED = "00000000-0000-4000-8000-000000000005";
// Sign-ups after 0016.
const MARCUS = "00000000-0000-4000-8000-000000000101";
const COPYCAT = "00000000-0000-4000-8000-000000000102";
const ODD_ID = "00000000-0000-4000-8000-000000000103";
const EDITOR = "00000000-0000-4000-8000-000000000104";
const LEAVER = "00000000-0000-4000-8000-000000000105";

/** Refuses anything but a local database named for testing, because this suite drops the public schema. */
function requireDisposableDatabase(url: string): string {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!loopback || !databaseName.includes("test")) {
    throw new Error(
      `USER_HANDLES_TEST_DATABASE_URL must be a local database with "test" in its name (got ${parsed.hostname}/${databaseName}).`,
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

// A string variable so TypeScript doesn't try to resolve `pg`, which is not a dependency of this project.
const DRIVER: string = "pg";

describe.skipIf(!DATABASE_URL)("UC1-01/UC1-03 user IDs against Postgres", () => {
  let client: PgClient;

  async function runMigration(file: string): Promise<void> {
    await client.query(await readFile(path.join(process.cwd(), "supabase", "migrations", file), "utf8"));
  }

  async function signUp(userId: string, metadata: Record<string, unknown>): Promise<void> {
    await client.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)", [userId, JSON.stringify(metadata)]);
  }

  async function handleOf(userId: string): Promise<string | null> {
    const { rows } = await client.query<{ handle: string | null }>("select handle from public.profiles where user_id = $1", [userId]);
    return rows[0]?.handle ?? null;
  }

  /** Calls update_profile as the signed-in `userId`, the way the profile store does. */
  async function updateProfile(userId: string, handle?: string): Promise<void> {
    await client.query("select set_config('test.uid', $1, false)", [userId]);
    const handleArgument = handle === undefined ? "" : ", p_handle => $2";
    await client.query(
      `select public.update_profile(p_user_id => $1, p_display_name => 'Editor',
         p_preferred_sports => array['Tennis'], p_preferred_regions => array['West']${handleArgument})`,
      handle === undefined ? [userId] : [userId, handle],
    );
  }

  beforeAll(async () => {
    const pg = (await import(DRIVER)) as PgModule;
    client = new pg.Client({ connectionString: requireDisposableDatabase(DATABASE_URL as string) });
    await client.connect();

    // Fresh schemas. A test database has no Supabase Auth, so stand in for the parts these migrations use.
    await client.query("drop schema if exists public cascade");
    await client.query("drop schema if exists auth cascade");
    await client.query("create schema public");
    await client.query(`
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    `);
    for (const migration of MIGRATIONS_BEFORE_0016) await runMigration(migration);

    // Accounts that signed up before user IDs existed, including two with the same name.
    await signUp(OLD_MARCUS, { display_name: "Marcus Lim" });
    await signUp(OLD_MARCUS_TWIN, { display_name: "Marcus Lim" });
    await signUp(OLD_NON_LATIN, { display_name: "李明" });
    await signUp(OLD_UNNAMED, {});
    await signUp(OLD_DELETED, { display_name: "Gone" });
    await client.query("update public.profiles set display_name = '', account_status = 'INACTIVE' where user_id = $1", [OLD_DELETED]);

    await runMigration("0016_user_handles.sql");
    await signUp(MARCUS, { display_name: "Marcus", handle: "@Marcus_Tan" });
  });

  afterAll(async () => {
    await client?.end();
  });

  describe("existing accounts", () => {
    test("gives an existing account an ID made from its name", async () => {
      // Act
      const handle = await handleOf(OLD_MARCUS);

      // Assert
      expect(handle).toBe("marcus_lim");
    });

    test("adds a number when another existing account has the same name", async () => {
      // Act
      const handle = await handleOf(OLD_MARCUS_TWIN);

      // Assert
      expect(handle).toMatch(/^marcus_lim_\d{4}$/);
    });

    test("uses player IDs for names without usable letters, keeping them unique", async () => {
      // Act
      const handles = [await handleOf(OLD_NON_LATIN), await handleOf(OLD_UNNAMED)];

      // Assert
      expect(handles[0]).toMatch(/^player(_\d{4})?$/);
      expect(handles[1]).toMatch(/^player(_\d{4})?$/);
      expect(handles[0]).not.toBe(handles[1]);
    });

    test("gives no ID to an account deleted before the migration", async () => {
      // Act
      const handle = await handleOf(OLD_DELETED);

      // Assert
      expect(handle).toBeNull();
    });
  });

  describe("sign-up", () => {
    test("keeps a valid user ID from sign-up in lower case, without the @", async () => {
      // Act
      const handle = await handleOf(MARCUS);

      // Assert
      expect(handle).toBe("marcus_tan");
    });

    test("still creates the account, with a numbered ID, when another account took the chosen ID first", async () => {
      // Arrange: a sign-up that checked the ID before Marcus's sign-up finished.
      await signUp(COPYCAT, { display_name: "Copycat", handle: "MARCUS_TAN" });

      // Act
      const handle = await handleOf(COPYCAT);

      // Assert
      expect(handle).toMatch(/^marcus_tan_\d{4}$/);
      const { rows } = await client.query("select 1 from public.wallets where user_id = $1", [COPYCAT]);
      expect(rows).toHaveLength(1);
    });

    test("replaces a user ID that breaks the rules with one made from the name", async () => {
      // Act
      await signUp(ODD_ID, { display_name: "Odd Jobs", handle: "9_lives__" });

      // Assert
      expect(await handleOf(ODD_ID)).toBe("odd_jobs");
    });
  });

  describe("keeping an ID on every active account", () => {
    test("refuses a stored user ID in the wrong form, even from a privileged writer", async () => {
      // Act & Assert
      await expect(client.query("update public.profiles set handle = 'Odd_Jobs2' where user_id = $1", [ODD_ID]))
        .rejects.toMatchObject({ code: "23514" });
    });

    test("generates a new ID instead of leaving an active account without one", async () => {
      // Act
      await client.query("update public.profiles set handle = null where user_id = $1", [ODD_ID]);

      // Assert
      expect(await handleOf(ODD_ID)).toMatch(/^odd_jobs(_\d{4})?$/);
    });
  });

  describe("Edit profile", () => {
    test("sets a free user ID through update_profile", async () => {
      // Arrange
      await signUp(EDITOR, { display_name: "Editor", handle: "editor_zero" });

      // Act
      await updateProfile(EDITOR, "editor_one");

      // Assert
      expect(await handleOf(EDITOR)).toBe("editor_one");
    });

    test("keeps the user ID when an older app version calls update_profile without p_handle", async () => {
      // Act
      await updateProfile(EDITOR);

      // Assert
      expect(await handleOf(EDITOR)).toBe("editor_one");
    });

    test("reports a user ID held by another account as PRF04 and keeps the old one", async () => {
      // Act & Assert
      await expect(updateProfile(EDITOR, "marcus_lim")).rejects.toMatchObject({ code: "PRF04" });
      expect(await handleOf(EDITOR)).toBe("editor_one");
    });

    test("reports a malformed user ID as PRF02", async () => {
      // Act & Assert
      await expect(updateProfile(EDITOR, "Editor_One")).rejects.toMatchObject({ code: "PRF02" });
    });
  });

  describe("account deletion", () => {
    test("frees a deactivated account's user ID for someone else", async () => {
      // Arrange: account deletion blanks the profile and its handle (lib/supabase/account-admin.ts).
      await signUp(LEAVER, { display_name: "Leaver", handle: "leaving_soon" });
      await client.query(
        "update public.profiles set display_name = '', handle = null, account_status = 'INACTIVE' where user_id = $1",
        [LEAVER],
      );

      // Act
      await updateProfile(EDITOR, "leaving_soon");

      // Assert
      expect(await handleOf(EDITOR)).toBe("leaving_soon");
    });

    test("gives a restored account a new ID when its old one was taken meanwhile", async () => {
      // Act: the deletion undo restores the details without the taken ID.
      await client.query(
        "update public.profiles set display_name = 'Leaver', handle = null, account_status = 'ACTIVE' where user_id = $1",
        [LEAVER],
      );

      // Assert
      expect(await handleOf(LEAVER)).toBe("leaver");
    });
  });
});
