import { readFile } from "node:fs/promises";
import path from "node:path";
import { Money, type FinancialInstruction } from "@/domain";
import {
  LedgerUnitOfWork,
  PLATFORM_HOLDING_ACCOUNT_ID,
  assertReconciled,
  type SqlExecutor,
  type SqlRow,
  type SqlTransactor,
} from "@/lib/money";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

/**
 * The same concurrency scenarios as `ledger-concurrency.test.ts`, run against
 * real Postgres.
 *
 * This is the half that proves the schema: the apply trigger, the CHECK
 * constraints, and `select ... for update` actually serialising twenty
 * transactions. The in-memory version cannot, because it re-implements those
 * rules rather than exercising them.
 *
 * Skipped unless `LEDGER_TEST_DATABASE_URL` points at a throwaway database,
 * because CI has no Postgres. To run it:
 *
 * ```bash
 * npx supabase start
 * LEDGER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
 * ```
 *
 * It drops and recreates the `public` schema, so it refuses to run against
 * anything but a loopback address — see `requireLoopbackDatabase`.
 */

const DATABASE_URL = process.env.LEDGER_TEST_DATABASE_URL;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Refuses any database that is not on this machine.
 *
 * This suite runs `drop schema public cascade`. The hosted project's
 * connection string is one paste away in `supabase/README.md`, and a comment
 * asking people to be careful is not a safeguard against pasting it. Losing
 * the team's database the week before a demo is not a recoverable mistake, so
 * the check is a hard failure rather than a warning.
 */
function requireLoopbackDatabase(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      "LEDGER_TEST_DATABASE_URL is not a valid connection URL.",
    );
  }

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `LEDGER_TEST_DATABASE_URL points at ${hostname}, which is not this machine. ` +
        "This suite runs 'drop schema public cascade' and would destroy every table in " +
        "that database. Run 'npx supabase start' and point it at 127.0.0.1 instead.",
    );
  }

  return url;
}

const MIGRATIONS = [
  "0001_wallet_ledger.sql",
  "0002_idempotency_and_reconciliation.sql",
  "0003_ledger_rls.sql",
];

const TABLES_TO_CLEAR = [
  "ledger_entries",
  "hold_balances",
  "payout_payables",
  "wallet_balances",
  "wallets",
  "idempotency_keys",
  "processed_events",
  "provider_balance_snapshots",
  "reconciliation_runs",
  "fake_sessions",
];

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SHARE = Money.fromCents(1250);
const CAPACITY = 8;
const CONTENDERS = 20;
const OCCURRED_AT = new Date("2026-09-17T12:00:00.000Z");

interface PgQueryResult {
  readonly rows: Record<string, unknown>[];
}

interface PgClient {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(): void;
}

interface PgPool {
  connect(): Promise<PgClient>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
}

interface PgModule {
  readonly Pool: new (config: { connectionString: string }) => PgPool;
}

// Annotated as `string` so TypeScript treats this as a dynamic specifier and
// does not try to resolve `pg`, which is not a dependency of this project.
const DRIVER: string = "pg";

describe.skipIf(!DATABASE_URL)("ledger concurrency against Postgres", () => {
  let pool: PgPool;
  let transactor: SqlTransactor;
  let unitOfWork: LedgerUnitOfWork;

  beforeAll(async () => {
    const connectionString = requireLoopbackDatabase(DATABASE_URL as string);

    const pg = (await import(DRIVER)) as PgModule;
    pool = new pg.Pool({ connectionString });

    await pool.query("drop schema if exists public cascade");
    await pool.query("create schema public");

    for (const migration of MIGRATIONS) {
      const sql = await readFile(
        path.join(process.cwd(), "supabase", "migrations", migration),
        "utf8",
      );
      await pool.query(sql);
    }

    // Stands in for the sessions table, which belongs to the session role and
    // does not exist yet. Only the slot counter this test needs.
    await pool.query(`
      create table fake_sessions (
        session_id uuid primary key,
        capacity integer not null,
        committed integer not null default 0,
        constraint fake_sessions_within_capacity check (committed <= capacity)
      )
    `);

    transactor = transactorFor(pool);
    unitOfWork = new LedgerUnitOfWork(transactor);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // ledger_entries refuses TRUNCATE by trigger, which is the point of it, so
    // the triggers come off for the reset and straight back on.
    await pool.query("alter table ledger_entries disable trigger user");
    await pool.query(
      `truncate ${TABLES_TO_CLEAR.join(", ")} restart identity cascade`,
    );
    await pool.query("alter table ledger_entries enable trigger user");
  });

  test("concurrency: twenty simultaneous commitments fill eight slots exactly", async () => {
    // Arrange
    await pool.query(
      "insert into fake_sessions (session_id, capacity) values ($1, $2)",
      [SESSION_ID, CAPACITY],
    );

    const participants = await seedParticipants(pool, CONTENDERS, SHARE.toCents() * 4);

    // Act
    const outcomes = await Promise.all(
      participants.map((person) => commit(unitOfWork, person)),
    );

    // Assert
    expect(outcomes.filter((it) => it.outcome === "COMMITTED")).toHaveLength(
      CAPACITY,
    );
    expect(outcomes.filter((it) => it.outcome === "WAITLISTED")).toHaveLength(
      CONTENDERS - CAPACITY,
    );

    const held = await scalar(
      pool,
      "select held_cents from session_held_totals where session_id = $1",
      [SESSION_ID],
    );
    expect(held).toBe(String(CAPACITY * SHARE.toCents()));

    const entries = await scalar(pool, "select count(*) from ledger_entries", []);
    expect(entries).toBe(String(CAPACITY));

    // The real payoff: after twenty racing transactions, the ledger still
    // balances and every projection still matches the entries behind it.
    const report = await assertReconciled(executorFor(pool));
    expect(report.passed).toBe(true);
  }, 60_000);

  test("concurrency: simultaneous locks cannot overdraw one wallet", async () => {
    // Arrange
    const affordable = 3;
    const [person] = await seedParticipants(
      pool,
      1,
      SHARE.toCents() * affordable,
    );
    if (person === undefined) throw new Error("No participant was seeded");

    // Act
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, (_unused, index) =>
        unitOfWork.execute(
          {
            idempotencyKey: `lock-${index}`,
            scope: "UC2-04:commit",
            request: { index },
          },
          async ({ ledger }) => {
            await ledger.append([
              lockInstruction({
                walletId: person.walletId,
                sessionId: SESSION_ID,
                holdId: uuidFor("cccccccc", index),
                participationId: uuidFor("bbbbbbbb", index),
              }),
            ]);
            return { locked: index };
          },
        ),
      ),
    );

    // Assert
    expect(results.filter((it) => it.status === "fulfilled")).toHaveLength(
      affordable,
    );

    const balance = await scalar(
      pool,
      "select available_cents from wallet_balances where wallet_id = $1",
      [person.walletId],
    );
    expect(balance).toBe("0");

    const report = await assertReconciled(executorFor(pool));
    expect(report.passed).toBe(true);
  }, 60_000);

  test("the ledger refuses to be rewritten", async () => {
    // Arrange
    const [person] = await seedParticipants(pool, 1, SHARE.toCents());
    if (person === undefined) throw new Error("No participant was seeded");

    await unitOfWork.execute(
      { idempotencyKey: "append-once", scope: "test", request: {} },
      async ({ ledger }) => {
        await ledger.append([
          lockInstruction({
            walletId: person.walletId,
            sessionId: SESSION_ID,
            holdId: uuidFor("cccccccc", 0),
            participationId: uuidFor("bbbbbbbb", 0),
          }),
        ]);
        return { done: true };
      },
    );

    // Act and assert
    await expect(
      pool.query("update ledger_entries set amount_cents = 1"),
    ).rejects.toThrow(/append-only/);

    await expect(pool.query("delete from ledger_entries")).rejects.toThrow(
      /append-only/,
    );
  }, 60_000);
});

interface Participant {
  readonly userId: string;
  readonly walletId: string;
  readonly participationId: string;
  readonly holdId: string;
}

async function seedParticipants(
  pool: PgPool,
  count: number,
  startingCents: number,
): Promise<readonly Participant[]> {
  const participants = Array.from({ length: count }, (_unused, index) => ({
    userId: uuidFor("dddddddd", index),
    walletId: uuidFor("aaaaaaaa", index),
    participationId: uuidFor("bbbbbbbb", index),
    holdId: uuidFor("cccccccc", index),
  }));

  for (const person of participants) {
    await pool.query(
      "insert into wallets (wallet_id, user_id) values ($1, $2)",
      [person.walletId, person.userId],
    );

    if (startingCents > 0) {
      // Funded the way real money arrives: through the ledger, not by writing
      // a balance.
      await pool.query(
        `insert into ledger_entries
           (kind, amount_cents, occurred_at, idempotency_key, external_reference, wallet_id)
         values ('TOP_UP', $1, $2, $3, $4, $5)`,
        [
          startingCents,
          OCCURRED_AT,
          `seed-topup-${person.walletId}`,
          `pi_seed_${person.walletId}`,
          person.walletId,
        ],
      );
    }
  }

  return participants;
}

async function commit(
  unitOfWork: LedgerUnitOfWork,
  person: Participant,
): Promise<{ outcome: "COMMITTED" | "WAITLISTED" }> {
  return unitOfWork.execute(
    {
      idempotencyKey: `commit:${SESSION_ID}:${person.userId}`,
      scope: "UC2-04:commit",
      request: { sessionId: SESSION_ID, userId: person.userId },
    },
    async ({ sql, ledger }) => {
      const rows = await sql.query<{ capacity: unknown; committed: unknown }>(
        "select capacity, committed from fake_sessions where session_id = $1 for update",
        [SESSION_ID],
      );

      const row = rows[0];
      if (row === undefined) throw new Error("The session does not exist");
      if (Number(row.committed) >= Number(row.capacity)) {
        return { outcome: "WAITLISTED" as const };
      }

      await sql.query(
        "update fake_sessions set committed = committed + 1 where session_id = $1",
        [SESSION_ID],
      );

      await ledger.append([
        lockInstruction({
          walletId: person.walletId,
          sessionId: SESSION_ID,
          holdId: person.holdId,
          participationId: person.participationId,
        }),
      ]);

      return { outcome: "COMMITTED" as const };
    },
  );
}

function lockInstruction(references: {
  walletId: string;
  sessionId: string;
  holdId: string;
  participationId: string;
}): FinancialInstruction {
  return {
    kind: "LOCK",
    sessionId: references.sessionId,
    participationId: references.participationId,
    holdId: references.holdId,
    holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
    walletId: references.walletId,
    amount: SHARE,
    occurredAt: OCCURRED_AT,
  };
}

function executorFor(pool: PgPool): SqlExecutor {
  return {
    query: async <TRow extends SqlRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<readonly TRow[]> => {
      const result = await pool.query(text, values ? [...values] : undefined);
      return result.rows as unknown as readonly TRow[];
    },
  };
}

function transactorFor(pool: PgPool): SqlTransactor {
  return {
    async transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await work({
          query: async <TRow extends SqlRow>(
            text: string,
            values?: readonly unknown[],
          ): Promise<readonly TRow[]> => {
            const queried = await client.query(
              text,
              values ? [...values] : undefined,
            );
            return queried.rows as unknown as readonly TRow[];
          },
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function scalar(
  pool: PgPool,
  text: string,
  values: readonly unknown[],
): Promise<string> {
  const result = await pool.query(text, [...values]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`No row returned by: ${text}`);
  return String(Object.values(row)[0]);
}

function uuidFor(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}
