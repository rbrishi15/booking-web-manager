import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

/**
 * UC1-06 save_regular_group (migration 0005) against real Postgres: a group and its
 * membership changes are saved in one transaction, and a save based on an older read
 * of the group is rejected instead of overwriting newer state.
 *
 * The sessions table belongs to the session work and is not in 0005, so the archive
 * tests create a stand-in with only the columns 0005 relies on, plus the trigger the
 * sessions migration is expected to add (see section 4 of 0005).
 *
 * Skipped unless `GROUPS_TEST_DATABASE_URL` points at a throwaway database (CI has no
 * Postgres). It drops and
 * recreates the `public` schema, so it only runs against a loopback host and a
 * database with "test" in its name. To run it:
 *
 * ```bash
 * npx supabase start
 * psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "create database groups_test"
 * GROUPS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/groups_test npm test
 * ```
 */

const DATABASE_URL = process.env.GROUPS_TEST_DATABASE_URL;

const MIGRATIONS = [
  "0001_wallet_ledger.sql",
  "0002_idempotency_and_reconciliation.sql",
  "0003_ledger_rls.sql",
  "0004_profiles.sql",
  "0005_regular_groups.sql",
  "0010_group_account_guards.sql",
];
const migrationPath = (file: string) => path.join(process.cwd(), "supabase", "migrations", file);
const HAS_MIGRATIONS = MIGRATIONS.every((file) => existsSync(migrationPath(file)));

const OWNER = "00000000-0000-4000-8000-00000000000a";
const JOINER = "00000000-0000-4000-8000-00000000000b";
const NOT_A_USER = "00000000-0000-4000-8000-0000000000ff";

/** Refuses anything but a local database named for testing, because this suite drops the public schema. */
function requireDisposableDatabase(url: string): string {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!loopback || !databaseName.includes("test")) {
    throw new Error(
      `GROUPS_TEST_DATABASE_URL must be a local database with "test" in its name (got ${parsed.hostname}/${databaseName}).`,
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

interface SaveArgs {
  readonly groupId: string;
  readonly expectedVersion: number | null;
  readonly invitationActive?: boolean;
  readonly status?: "ACTIVE" | "ARCHIVED";
  readonly added?: readonly string[];
  readonly removed?: readonly string[];
}

describe.skipIf(!DATABASE_URL || !HAS_MIGRATIONS)("UC1-06 save_regular_group against Postgres", () => {
  let client: PgClient;
  let connect: () => Promise<PgClient>;
  let groupNumber = 0;
  let groupId: string;

  /** Calls save_regular_group the way lib/supabase/group-store.ts does. */
  async function save(args: SaveArgs): Promise<number> {
    const { rows } = await client.query<{ version: number }>(
      "select public.save_regular_group($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid[]) as version",
      [
        args.groupId,
        OWNER,
        "Weekend Tennis",
        `token-${args.groupId}-${args.invitationActive ?? true}`,
        args.invitationActive ?? true,
        args.status ?? "ACTIVE",
        args.expectedVersion,
        JSON.stringify((args.added ?? []).map((userId) => ({ user_id: userId, joined_at: new Date().toISOString() }))),
        args.removed ?? [],
      ],
    );
    return rows[0]!.version;
  }

  async function groupState(id: string) {
    const { rows: groups } = await client.query<{ invitation_active: boolean; status: string; version: number }>(
      "select invitation_active, status, version from regular_groups where group_id = $1",
      [id],
    );
    const { rows: members } = await client.query<{ user_id: string }>(
      "select user_id from group_memberships where group_id = $1 order by user_id",
      [id],
    );
    return { group: groups[0] ?? null, members: members.map((member) => member.user_id) };
  }

  beforeAll(async () => {
    const connectionString = requireDisposableDatabase(DATABASE_URL as string);
    const pg = (await import(DRIVER)) as PgModule;
    connect = async () => {
      const connection = new pg.Client({ connectionString });
      await connection.connect();
      return connection;
    };
    client = await connect();

    // Fresh schemas. A test database has no Supabase Auth, so stand in for the parts 0004 uses.
    await client.query("drop schema if exists public cascade");
    await client.query("drop schema if exists auth cascade");
    await client.query("create schema public");
    await client.query(`
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    for (const file of MIGRATIONS) await client.query(await readFile(migrationPath(file), "utf8"));

    // Two registered users (the sign-up trigger gives each a profile).
    await client.query("insert into auth.users (id) values ($1), ($2)", [OWNER, JOINER]);
  });

  beforeEach(() => {
    groupNumber += 1;
    groupId = `10000000-0000-4000-8000-${String(groupNumber).padStart(12, "0")}`;
  });

  afterAll(async () => {
    await client?.end();
  });

  test("creates a group together with its owner's membership", async () => {
    // Act
    const version = await save({ groupId, expectedVersion: null, added: [OWNER] });

    // Assert
    expect(version).toBe(0);
    expect(await groupState(groupId)).toEqual({
      group: { invitation_active: true, status: "ACTIVE", version: 0 },
      members: [OWNER],
    });
  });

  test("saves nothing when a membership insert fails during creation", async () => {
    // Act & Assert: the second member doesn't exist, so the membership insert fails.
    await expect(save({ groupId, expectedVersion: null, added: [OWNER, NOT_A_USER] })).rejects.toThrow();
    expect(await groupState(groupId)).toEqual({ group: null, members: [] });
  });

  test("rejects a join that read the group before the owner revoked the link", async () => {
    // Arrange: the join reads version 0; then the owner revokes the link (version 0 → 1).
    await save({ groupId, expectedVersion: null, added: [OWNER] });
    const versionTheJoinRead = 0;
    await save({ groupId, expectedVersion: 0, invitationActive: false });

    // Act & Assert: the join resumes with its stale read.
    await expect(
      save({ groupId, expectedVersion: versionTheJoinRead, invitationActive: true, added: [JOINER] }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(await groupState(groupId)).toEqual({
      group: { invitation_active: false, status: "ACTIVE", version: 1 },
      members: [OWNER],
    });
  });

  test("adds and removes members when nobody saved the group in between", async () => {
    // Arrange
    await save({ groupId, expectedVersion: null, added: [OWNER] });
    const joined = await save({ groupId, expectedVersion: 0, added: [JOINER] });

    // Act
    const removed = await save({ groupId, expectedVersion: joined, removed: [JOINER] });

    // Assert
    expect([joined, removed]).toEqual([1, 2]);
    expect((await groupState(groupId)).members).toEqual([OWNER]);
  });

  test("archives a group before the sessions table exists", async () => {
    // Arrange
    await client.query("drop table if exists sessions");
    await save({ groupId, expectedVersion: null, added: [OWNER] });

    // Act
    const version = await save({ groupId, expectedVersion: 0, status: "ARCHIVED" });

    // Assert
    expect(version).toBe(1);
    expect((await groupState(groupId)).group?.status).toBe("ARCHIVED");
  });

  test("archives a group whose linked sessions are all settled or cancelled", async () => {
    // Arrange
    await createSessionsTable(client);
    await save({ groupId, expectedVersion: null, added: [OWNER] });
    await insertLinkedSession(client, groupId, "SETTLED");
    await insertLinkedSession(client, groupId, "CANCELLED");

    // Act
    await save({ groupId, expectedVersion: 0, status: "ARCHIVED" });

    // Assert
    expect((await groupState(groupId)).group?.status).toBe("ARCHIVED");
  });

  test("refuses to archive a group with an unsettled linked session", async () => {
    // Arrange: an OPEN session invited from this group.
    await createSessionsTable(client);
    await save({ groupId, expectedVersion: null, added: [OWNER] });
    await insertLinkedSession(client, groupId);

    // Act & Assert
    await expect(save({ groupId, expectedVersion: 0, status: "ARCHIVED" })).rejects.toMatchObject({ code: "GRP01" });
    expect((await groupState(groupId)).group?.status).toBe("ACTIVE");
  });

  test("refuses to archive while a linked session is being created at the same moment", async () => {
    // Arrange: a second connection has inserted a session invited from this group but not committed yet.
    await createSessionsTable(client);
    await save({ groupId, expectedVersion: null, added: [OWNER] });
    const creator = await connect();
    try {
      await creator.query("begin");
      await insertLinkedSession(creator, groupId);

      // Act: the owner archives now, and the session commits a moment later.
      const archiveOutcome = save({ groupId, expectedVersion: 0, status: "ARCHIVED" }).then(
        () => "ARCHIVED",
        (error: { code?: string }) => error.code,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await creator.query("commit");

      // Assert: the archive waited for the session and then saw it.
      expect(await archiveOutcome).toBe("GRP01");
      expect((await groupState(groupId)).group?.status).toBe("ACTIVE");
    } finally {
      await creator.query("rollback").catch(() => undefined);
      await creator.end();
    }
  });
});

/**
 * A stand-in for the session work's table: only the columns 0005 reads, and the trigger
 * its migration must add so a linked session and an archive can't overlap.
 */
async function createSessionsTable(connection: PgClient): Promise<void> {
  await connection.query(`
    create table if not exists sessions (
      session_id uuid primary key default gen_random_uuid(),
      invited_group_id uuid,
      status text not null
    );
    create or replace trigger sessions_lock_invited_group
      before insert or update of invited_group_id on sessions
      for each row execute function public.lock_invited_group();
  `);
}

/** A session invited from the group, OPEN unless a status is given. */
async function insertLinkedSession(connection: PgClient, invitedGroupId: string, status = "OPEN"): Promise<void> {
  await connection.query("insert into sessions (invited_group_id, status) values ($1, $2)", [invitedGroupId, status]);
}
