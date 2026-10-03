import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionCreationTransaction } from "@/lib/sessions/postgres-session-creation-transaction";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresUserReader } from "@/lib/sessions/postgres-user-reader";
import { PostgresSessionManagementRepository } from "@/lib/sessions/postgres-session-management-repository";
import { PostgresSessionDiscoveryReader } from "@/lib/sessions/postgres-session-discovery-reader";
import type { SqlExecutor } from "@/lib/money/sql";
import {
  CreateSessions,
  type SessionBooking,
} from "@/use-cases/sessions/CreateSessions";
import type { SessionCreationTransaction } from "@/use-cases/sessions/session-creation-transaction";
import {
  sessionTestContext,
  type SessionTestContext,
} from "../support/session-test-context";

const now = new Date("2030-01-01T00:00:00Z");
const clock = { now: () => new Date(now) };
const booking: SessionBooking = {
  venueName: "Jurong East Sports Hall",
  sport: "Badminton",
  region: "West",
  startAt: new Date("2030-01-02T10:00:00Z"),
  endAt: new Date("2030-01-02T12:00:00Z"),
  totalCostCents: 1001,
};
const config = { totalSlots: 3 };
const operationKey = (userId: string, key: string) =>
  JSON.stringify(["UC2-02", userId, key]);

describe("UC2-02 PostgreSQL persistence", () => {
  let context: SessionTestContext;
  beforeAll(() => {
    context = sessionTestContext();
  });
  afterAll(async () => {
    await context?.pool.end();
  });

  function transaction(key: string) {
    return new PostgresSessionCreationTransaction(
      context.pool,
      { idempotencyKey: key },
      clock,
    );
  }
  function useCase(unit: SessionCreationTransaction) {
    return new CreateSessions({
      transaction: unit,
      clock,
      ids: { next: randomUUID },
      holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
    });
  }

  test("persists session and durable replay without moving funds", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const created = await useCase(transaction(key)).forBooker(
      booker.userId,
      booking,
      { ...config, visibility: "PUBLIC", minimumReliability: 75.5 },
    );
    expect(created.bookingShareCents).toBe(333);
    const stored = await context.pool.query(
      "select booker_id, booking_share_cents, visibility, minimum_reliability, room_token, status from sessions where session_id = $1",
      [created.sessionId],
    );
    expect(stored.rows).toEqual([
      {
        booker_id: booker.userId,
        booking_share_cents: "333",
        visibility: "PUBLIC",
        minimum_reliability: "75.5",
        room_token: created.roomToken,
        status: "OPEN",
      },
    ]);
    const replay = await context.pool.query(
      "select status from idempotency_keys where idempotency_key = $1",
      [operationKey(booker.userId, key)],
    );
    expect(replay.rows).toEqual([{ status: "SUCCEEDED" }]);
    const effects = await context.pool.query(
      `select
      (select count(*)::int from ledger_entries where wallet_id = $1 or session_id = $2) as ledger,
      (select count(*)::int from participations where session_id = $2) as participants,
      (select count(*)::int from payout_payables where session_id = $2) as payouts`,
      [booker.walletId, created.sessionId],
    );
    expect(effects.rows).toEqual([{ ledger: 0, participants: 0, payouts: 0 }]);
  });

  test("serializes eight simultaneous retries across independent adapters", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        useCase(transaction(key)).forBooker(booker.userId, booking, config),
      ),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(
      (
        await context.pool.query(
          "select count(*)::int as count from sessions where booker_id = $1",
          [booker.userId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  test("persists and replays custom prices and enforces the new database bounds", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const created = await useCase(transaction(key)).forBooker(booker.userId, booking, { ...config, visibility: "PUBLIC", pricePerSlotCents: 600 });
    expect(created.bookingShareCents).toBe(600);
    expect((await context.pool.query("select booking_share_cents from sessions where session_id = $1", [created.sessionId])).rows).toEqual([{ booking_share_cents: "600" }]);
    expect(await useCase(transaction(key)).forBooker(booker.userId, booking, { ...config, pricePerSlotCents: 500 })).toEqual(created);
    const sql: SqlExecutor = { query: async (statement, values) => (await context.pool.query(statement, values ? [...values] : undefined)).rows };
    expect((await new PostgresSessionManagementRepository(sql).get(created.sessionId))?.bookingShare.toCents()).toBe(600);
    expect((await new PostgresSessionDiscoveryReader(sql).search({}, now)).find((session) => session.sessionId === created.sessionId)?.bookingShareCents).toBe(600);
    for (const invalid of [166, 667]) {
      await expect(context.pool.query("update sessions set booking_share_cents = $2 where session_id = $1", [created.sessionId, invalid])).rejects.toMatchObject({ code: "23514", constraint: "sessions_price_within_range" });
    }
  });

  test("migration preserves equal-split sessions and historical holds without rewriting rows", async () => {
    const connection = await context.pool.connect();
    try {
      // Temporary tables shadow public tables, keeping the migration rehearsal isolated.
      await connection.query(`create temporary table sessions (session_id text, total_cost_cents bigint, total_slots integer, booking_share_cents bigint,
        constraint sessions_calculated_share check (booking_share_cents = total_cost_cents / total_slots))`);
      await connection.query("create temporary table fund_holds (session_id text, amount_cents bigint)");
      await connection.query("insert into sessions values ('odd',1001,3,333),('cent',2,2,1),('safe',9007199254740991,8,1125899906842623)");
      await connection.query("insert into fund_holds values ('odd',333),('safe',1125899906842623)");
      const before = (await connection.query("select * from sessions order by session_id")).rows;
      const holds = (await connection.query("select * from fund_holds order by session_id")).rows;
      await connection.query(await readFile("supabase/migrations/0008_session_pricing.sql", "utf8"));
      expect((await connection.query("select * from sessions order by session_id")).rows).toEqual(before);
      expect((await connection.query("select * from fund_holds order by session_id")).rows).toEqual(holds);
      await connection.query("insert into sessions values ('custom',1001,3,600)");
      await expect(connection.query("update sessions set booking_share_cents = 1125899906842624 where session_id = 'safe'"))
        .rejects.toMatchObject({ code: "23514", constraint: "sessions_price_within_range" });
    } finally {
      await connection.query("rollback");
      await connection.query("drop table if exists pg_temp.fund_holds, pg_temp.sessions");
      connection.release();
    }
  });

  test("configuration migration removes its obsolete column and preserves sessions and historical holds", async () => {
    const migration = await readFile("supabase/migrations/0009_session_capacity.sql", "utf8");
    const removedColumn = /drop column (\w+)/i.exec(migration)?.[1];
    if (!removedColumn) throw new Error("Expected one configuration column removal");
    const previousSchema = await readFile("supabase/migrations/0006_session_creation.sql", "utf8");
    const definition = previousSchema.split("\n").find((line) => line.trimStart().startsWith(`${removedColumn} `))?.trim().replace(/,$/, "");
    if (!definition) throw new Error("Expected the original column definition");
    const connection = await context.pool.connect();
    try {
      await connection.query(`create temporary table sessions (session_id text, total_cost_cents bigint,
        total_slots integer constraint sessions_total_slots_check check (total_slots between 1 and 8),
        booking_share_cents bigint, ${definition})`);
      await connection.query("create temporary table fund_holds (session_id text, amount_cents bigint)");
      await connection.query("insert into sessions values ('legacy',1001,3,333,2),('custom',1001,3,600,3)");
      await connection.query("insert into fund_holds values ('legacy',333),('custom',600)");
      const sessions = (await connection.query("select session_id, total_cost_cents, total_slots, booking_share_cents from sessions order by session_id")).rows;
      const holds = (await connection.query("select * from fund_holds order by session_id")).rows;
      await connection.query(migration);
      expect((await connection.query("select * from sessions order by session_id")).rows).toEqual(sessions);
      expect((await connection.query("select * from fund_holds order by session_id")).rows).toEqual(holds);
      expect((await connection.query("select count(*)::int as count from pg_attribute where attrelid = 'pg_temp.sessions'::regclass and attname = $1 and not attisdropped", [removedColumn])).rows).toEqual([{ count: 0 }]);
      await expect(connection.query("insert into sessions values ('one',100,1,100)"))
        .rejects.toMatchObject({ code: "23514", constraint: "sessions_total_slots_check" });
      await expect(connection.query("insert into sessions values ('nine',900,9,100)"))
        .rejects.toMatchObject({ code: "23514", constraint: "sessions_total_slots_check" });
    } finally {
      await connection.query("rollback");
      await connection.query("drop table if exists pg_temp.fund_holds, pg_temp.sessions");
      connection.release();
    }
  });

  test("replays changed valid input without rerunning payout or booking-time eligibility", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const created = await useCase(transaction(key)).forBooker(
      booker.userId,
      booking,
      config,
    );
    await context.pool.query(
      "update payout_accounts set setup_status = 'FAILED', bank_account_reference = null where user_id = $1",
      [booker.userId],
    );
    const replayCase = new CreateSessions({
      transaction: transaction(key),
      clock: { now: () => new Date("2031-01-01T00:00:00Z") },
      ids: {
        next: () => {
          throw new Error("Replay generated an identity");
        },
      },
      holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
    });
    expect(
      await replayCase.forBooker(
        booker.userId,
        { ...booking, venueName: "Changed venue", totalCostCents: 9999 },
        { totalSlots: 4 },
      ),
    ).toEqual(created);
    await expect(
      useCase(transaction(randomUUID())).forBooker(
        booker.userId,
        booking,
        config,
      ),
    ).rejects.toMatchObject({ code: "PAYOUT_ACCOUNT_NOT_READY" });
  });

  test("refuses durable replay after email confirmation is removed and resumes after reconfirmation", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const created = await useCase(transaction(key)).forBooker(booker.userId, booking, config);
    await context.pool.query("update auth.users set email_confirmed_at = null where id = $1", [booker.userId]);

    await expect(useCase(transaction(key)).forBooker(booker.userId, booking, config))
      .rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    expect((await context.pool.query(
      `select (select count(*)::int from sessions where booker_id = $1) as sessions,
       (select count(*)::int from idempotency_keys where idempotency_key = $2 and status = 'SUCCEEDED') as replay`,
      [booker.userId, operationKey(booker.userId, key)],
    )).rows).toEqual([{ sessions: 1, replay: 1 }]);

    await context.pool.query("update auth.users set email_confirmed_at = $2 where id = $1", [booker.userId, now]);
    expect(await useCase(transaction(key)).forBooker(booker.userId, booking, config)).toEqual(created);
  });

  test("rejects fresh creation without an email before persisting a session or replay claim", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    await context.pool.query("update auth.users set email = null, email_confirmed_at = null where id = $1", [booker.userId]);

    await expect(useCase(transaction(key)).forBooker(booker.userId, booking, config))
      .rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    expect((await context.pool.query(
      `select (select count(*)::int from sessions where booker_id = $1) as sessions,
       (select count(*)::int from idempotency_keys where idempotency_key = $2) as replay`,
      [booker.userId, operationKey(booker.userId, key)],
    )).rows).toEqual([{ sessions: 0, replay: 0 }]);
  });

  test("the same submission text is independently scoped to each booker", async () => {
    const first = await context.identity();
    const second = await context.identity();
    const key = randomUUID();
    const results = await Promise.all(
      [first, second].map((booker) =>
        useCase(transaction(key)).forBooker(booker.userId, booking, config),
      ),
    );
    expect(results[0]?.sessionId).not.toBe(results[1]?.sessionId);
  });

  test("rolls back an inserted session and replay claim when later work fails", async () => {
    const booker = await context.identity();
    const key = randomUUID();
    const failure: SessionCreationTransaction = {
      runForBooker: (userId, work) =>
        transaction(key).runForBooker(userId, ({ users, sessions }) =>
          work({
            users,
            sessions: {
              save: async (session) => {
                await sessions.save(session);
                throw new Error("Injected failure after insert");
              },
            },
          }),
        ),
    };
    await expect(
      useCase(failure).forBooker(booker.userId, booking, config),
    ).rejects.toThrow("Injected failure after insert");
    const counts = await context.pool.query(
      `select
      (select count(*)::int from sessions where booker_id = $1) as sessions,
      (select count(*)::int from idempotency_keys where idempotency_key = $2) as replay`,
      [booker.userId, operationKey(booker.userId, key)],
    );
    expect(counts.rows).toEqual([{ sessions: 0, replay: 0 }]);
    expect(
      await useCase(transaction(key)).forBooker(booker.userId, booking, config),
    ).toHaveProperty("sessionId");
  });

  test("refuses missing or corrupt related User state", async () => {
    const missing = await context.identity();
    await context.pool.query(
      "delete from wallet_balances where wallet_id = $1",
      [missing.walletId],
    );
    await context.pool.query("delete from wallets where wallet_id = $1", [
      missing.walletId,
    ]);
    await expect(
      useCase(transaction(randomUUID())).forBooker(
        missing.userId,
        booking,
        config,
      ),
    ).rejects.toMatchObject({ name: "SessionPersistenceError" });
    const corrupt = await context.identity();
    await context.pool.query(
      "update profiles set preferred_sports = '{\"\"}' where user_id = $1",
      [corrupt.userId],
    );
    await expect(
      useCase(transaction(randomUUID())).forBooker(
        corrupt.userId,
        booking,
        config,
      ),
    ).rejects.toMatchObject({ name: "SessionPersistenceError" });
    expect(
      (
        await context.pool.query(
          "select count(*)::int as count from sessions where booker_id = any($1::uuid[])",
          [[missing.userId, corrupt.userId]],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  });

  test("hydrates every ledger entry, preferences, payout, memberships and calculated attendance reliability", async () => {
    const booker = await context.identity();
    const owner = await context.identity();
    await context.pool.query(
      "update profiles set preferred_sports = '{Badminton}', preferred_regions = '{West}' where user_id = $1",
      [booker.userId],
    );
    await context.pool.query(
      `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, external_reference, wallet_id)
      select 'TOP_UP', 100, '2029-12-01T00:00:00Z', $2 || '-' || n, $2 || '-provider-' || n, $1 from generate_series(1,205) n`,
      [booker.walletId, randomUUID()],
    );
    const groupId = randomUUID();
    await context.pool.query(
      `insert into regular_groups (group_id, owner_id, name, invitation_token, invitation_active, status)
      values ($1,$2,'Fixture group',$3,true,'ACTIVE')`,
      [groupId, owner.userId, randomUUID()],
    );
    await context.pool.query(
      "insert into group_memberships (group_id, user_id, joined_at) values ($1,$2,$3)",
      [groupId, booker.userId, now],
    );
    for (const attendance of ["ATTENDED", "ABSENT"]) {
      const session = await useCase(transaction(randomUUID())).forBooker(
        owner.userId,
        booking,
        config,
      );
      await context.pool.query(
        "update sessions set start_at = '2029-12-01T10:00:00Z', end_at = '2029-12-01T12:00:00Z' where session_id = $1",
        [session.sessionId],
      );
      const participationId = randomUUID();
      const holdId = randomUUID();
      await context.pool.query(
        `insert into participations (participation_id, session_id, user_id, status, attendance, committed_at, verified_at, verification_method)
        values ($1,$2,$3,'COMMITTED',$4,'2029-11-30T10:00:00Z','2029-12-01T12:00:00Z','BOOKER')`,
        [participationId, session.sessionId, booker.userId, attendance],
      );
      await context.pool.query(
        `insert into fund_holds (hold_id, participation_id, holding_account_id, wallet_id, amount_cents, state, created_at)
        values ($1,$2,$3,$4,333,'HELD','2029-11-30T10:00:00Z')`,
        [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, booker.walletId],
      );
      await context.pool.query(
        `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, wallet_id, hold_id, holding_account_id, session_id, participation_id)
        values ('LOCK',333,'2029-11-30T10:00:00Z',$1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          booker.walletId,
          holdId,
          PLATFORM_HOLDING_ACCOUNT_ID,
          session.sessionId,
          participationId,
        ],
      );
    }
    const loaded = await new PostgresTransactor(context.pool).transaction(
      (sql) => new PostgresUserReader(sql, clock).get(booker.userId),
    );
    expect(loaded?.wallet.transactions).toHaveLength(207);
    expect(loaded?.wallet.getAvailableBalance().toCents()).toBe(19834);
    expect(loaded?.reliabilityScore.toNumber()).toBe(50);
    expect(loaded?.memberGroupIds).toEqual([groupId]);
    expect([...(loaded?.preferredSports ?? [])]).toEqual(["Badminton"]);
    expect([...(loaded?.preferredRegions ?? [])]).toEqual(["West"]);
    expect(loaded?.payoutAccount?.setupStatus).toBe("COMPLETE");
    expect(loaded?.email?.toString()).toBe(booker.email);
    expect(loaded?.emailVerified).toBe(true);
  });

  test("session group lock makes concurrent archive wait and reject unsettled obligations", async () => {
    const booker = await context.identity();
    const groupId = randomUUID();
    const invitation = randomUUID();
    await context.pool.query(
      `insert into regular_groups (group_id, owner_id, name, invitation_token, invitation_active, status)
      values ($1,$2,'Concurrent group',$3,true,'ACTIVE')`,
      [groupId, booker.userId, invitation],
    );
    const creator = await context.pool.connect();
    const archiver = await context.pool.connect();
    let archiveResult: Promise<unknown> | undefined;
    try {
      await creator.query("begin");
      await creator.query(
        `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at, total_cost_cents,
        total_slots, booking_share_cents, room_token, holding_account_id, invited_group_id)
        values ($1,$2,'Concurrent venue','West','Badminton',$3,$4,1001,3,333,$5,$6,$7)`,
        [
          randomUUID(),
          booker.userId,
          booking.startAt,
          booking.endAt,
          randomUUID(),
          PLATFORM_HOLDING_ACCOUNT_ID,
          groupId,
        ],
      );
      const pid = (
        await archiver.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]?.pid;
      archiveResult = archiver
        .query(
          "select save_regular_group($1,$2,$3,$4,true,'ARCHIVED',0,'[]'::jsonb,'{}'::uuid[])",
          [groupId, booker.userId, "Concurrent group", invitation],
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting =
          (
            await context.pool.query(
              "select wait_event_type from pg_stat_activity where pid = $1",
              [pid],
            )
          ).rows[0]?.wait_event_type === "Lock";
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await creator.query("commit");
      expect(await archiveResult).toMatchObject({ code: "GRP01" });
      expect(
        (
          await context.pool.query(
            "select status from regular_groups where group_id = $1",
            [groupId],
          )
        ).rows,
      ).toEqual([{ status: "ACTIVE" }]);
    } finally {
      await creator.query("rollback");
      await archiveResult;
      creator.release();
      archiver.release();
    }
  });

  test("anon and authenticated database roles cannot read private session facts", async () => {
    for (const role of ["anon", "authenticated"]) {
      const connection = await context.pool.connect();
      try {
        await connection.query("begin");
        await connection.query(`set local role ${role}`);
        await expect(
          connection.query("select room_token from sessions"),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await connection.query("rollback");
        connection.release();
      }
    }
  });
});
