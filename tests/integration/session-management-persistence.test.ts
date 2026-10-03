import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresSessionManagementRepository } from "@/lib/sessions/postgres-session-management-repository";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const now = new Date("2040-01-01T00:00:00Z");
const startAt = new Date("2040-01-02T10:00:00Z");
const endAt = new Date("2040-01-02T12:00:00Z");
const clock = { now: () => new Date(now) };

describe("UC2-03a PostgreSQL management", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });

  /** Creates a management transaction using the integration pool and fixed test clock. */
  function transaction() {
    return new PostgresSessionManagementTransaction(() => context.pool, clock);
  }

  test("migration initializes verified creation-only data and records participant-list insertion order", async () => {
    const connection = await context.pool.connect();
    try {
      // Connection-local legacy tables shadow the public schema, so replaying the
      // migration cannot alter the already migrated shared integration database.
      await connection.query("create temporary table sessions (session_id uuid primary key, status text not null)");
      await connection.query("create temporary table participations (session_id uuid not null)");
      const sessionId = randomUUID();
      await connection.query("insert into sessions values ($1,'OPEN')", [sessionId]);
      await connection.query(await readFile("supabase/migrations/0007_session_management.sql", "utf8"));
      expect((await connection.query("select payout_attempt_ids,payout_idempotency_keys,pending_settlement from sessions")).rows)
        .toEqual([{ payout_attempt_ids: [], payout_idempotency_keys: [], pending_settlement: null }]);
      await connection.query("insert into participations(session_id) values ($1),($1)", [sessionId]);
      expect((await connection.query("select list_position from participations order by list_position")).rows)
        .toEqual([{ list_position: "1" }, { list_position: "2" }]);
    } finally {
      await connection.query("rollback");
      await connection.query("drop table if exists pg_temp.participations,pg_temp.sessions");
      connection.release();
    }
  });

  test.each(["participation", "lifecycle"])("migration refuses unknown %s history without partially changing the schema", async (history) => {
    const connection = await context.pool.connect();
    try {
      await connection.query("create temporary table sessions (session_id uuid primary key, status text not null)");
      await connection.query("create temporary table participations (session_id uuid not null)");
      const sessionId = randomUUID();
      await connection.query("insert into sessions values ($1,$2)", [sessionId, history === "lifecycle" ? "AWAITING_PAYOUT" : "OPEN"]);
      if (history === "participation") await connection.query("insert into participations values ($1)", [sessionId]);
      await expect(connection.query(await readFile("supabase/migrations/0007_session_management.sql", "utf8")))
        .rejects.toThrow("requires verified backfill");
      await connection.query("rollback");
      expect((await connection.query(
        "select attname from pg_attribute where attrelid = 'pg_temp.sessions'::regclass and attname='payout_attempt_ids'",
      )).rows).toEqual([]);
    } finally {
      await connection.query("rollback");
      await connection.query("drop table if exists pg_temp.participations,pg_temp.sessions");
      connection.release();
    }
  });

  /** Inserts a private two-slot session fixture with optional lifecycle overrides and returns its ID. */
  async function createSession(bookerId: string, options: { status?: string; startAt?: Date } = {}) {
    const sessionId = randomUUID();
    await context.pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
        total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, status,
        room_token, holding_account_id)
       values ($1,$2,'Management fixture','West','Badminton',$3,$4,1000,2,2,500,'PRIVATE',$5,$6,$7)`,
      [sessionId, bookerId, options.startAt ?? startAt, endAt, options.status ?? "OPEN", randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
    );
    return sessionId;
  }

  /** Adapts the integration pool to the SQL executor used by fixture helpers. */
  function executor(): SqlExecutor {
    return { query: async (statement, values) => (await context.pool.query(statement, values ? [...values] : undefined)).rows };
  }

  /** Seeds a committed participation, hold, and matching top-up and lock ledger entries; returns participation and hold IDs. */
  async function addParticipant(sql: SqlExecutor, sessionId: string, participant: { userId: string; walletId: string }) {
    const participationId = randomUUID();
    const holdId = randomUUID();
    await sql.query(
      `insert into participations (participation_id,session_id,user_id,status,attendance,committed_at)
       values ($1,$2,$3,'COMMITTED','UNVERIFIED',$4)`,
      [participationId, sessionId, participant.userId, now],
    );
    await sql.query(
      `insert into fund_holds (hold_id,participation_id,holding_account_id,wallet_id,amount_cents,state,created_at)
       values ($1,$2,$3,$4,500,'HELD',$5)`,
      [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, participant.walletId, now],
    );
    await sql.query(
      `insert into ledger_entries (kind,amount_cents,occurred_at,idempotency_key,external_reference,wallet_id)
       values ('TOP_UP',500,$1,$2,$3,$4)`,
      [now, randomUUID(), randomUUID(), participant.walletId],
    );
    await sql.query(
      `insert into ledger_entries (kind,amount_cents,occurred_at,idempotency_key,wallet_id,hold_id,holding_account_id,session_id,participation_id)
       values ('LOCK',500,$1,$2,$3,$4,$5,$6,$7)`,
      [now, randomUUID(), participant.walletId, holdId, PLATFORM_HOLDING_ACCOUNT_ID, sessionId, participationId],
    );
    return { participationId, holdId };
  }

  /** Loads fixture aggregates, applies Booker visibility policy, and persists the result in a management transaction. */
  async function change(bookerId: string, sessionId: string, visibility: "PUBLIC" | "PRIVATE") {
    return transaction().run(async ({ users, sessions }) => {
      const user = await users.get(bookerId);
      const session = await sessions.get(sessionId);
      if (!user || !session) throw new Error("Fixture is missing");
      user.asBooker().changeVisibility(session, visibility, clock.now());
      await sessions.saveVisibility(session);
      return session.visibility;
    });
  }

  test("persists only visibility, including a same-value request, without financial effects", async () => {
    const booker = await context.identity(false);
    const sessionId = await createSession(booker.userId);
    const before = (await context.pool.query("select * from sessions where session_id=$1", [sessionId])).rows[0];
    expect(await change(booker.userId, sessionId, "PUBLIC")).toBe("PUBLIC");
    expect(await change(booker.userId, sessionId, "PUBLIC")).toBe("PUBLIC");
    const after = (await context.pool.query("select * from sessions where session_id=$1", [sessionId])).rows[0];
    expect(after).toEqual({ ...before, visibility: "PUBLIC" });
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1", [sessionId])).rows)
      .toEqual([{ count: 0 }]);
  });

  test("rolls back a visibility write if later work fails", async () => {
    const booker = await context.identity(false);
    const sessionId = await createSession(booker.userId);
    await expect(transaction().run(async ({ users, sessions }) => {
      const user = await users.get(booker.userId);
      const session = await sessions.get(sessionId);
      if (!user || !session) throw new Error("Fixture is missing");
      user.asBooker().changeVisibility(session, "PUBLIC", now);
      await sessions.saveVisibility(session);
      throw new Error("Failure after update");
    })).rejects.toThrow("Failure after update");
    expect((await transaction().run(({ sessions }) => sessions.get(sessionId)))?.visibility).toBe("PRIVATE");
  });

  test("lists only this booker's upcoming open sessions and retains full sessions", async () => {
    const booker = await context.identity(false);
    const foreign = await context.identity(false);
    const first = await context.identity(false);
    const second = await context.identity(false);
    const full = await createSession(booker.userId);
    await addParticipant(executor(), full, first);
    await addParticipant(executor(), full, second);
    await createSession(foreign.userId);
    await createSession(booker.userId, { status: "CANCELLED" });
    await createSession(booker.userId, { startAt: now });
    const sessions = await transaction().run(({ sessions }) => sessions.listUpcoming(booker.userId, now));
    expect(sessions.map((session) => session.sessionId)).toEqual([full]);
    expect(sessions[0]?.getAvailableSlots(now)).toBe(0);
    await expect(change(booker.userId, full, "PRIVATE")).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
  });

  test("hydrates pending settlement JSON, holds, stable participant-list order and failed attempt history", async () => {
    const booker = await context.identity();
    const first = await context.identity(false);
    const second = await context.identity(false);
    const sessionId = await createSession(booker.userId);
    const a = await addParticipant(executor(), sessionId, first);
    const b = await addParticipant(executor(), sessionId, second);
    const payoutId = randomUUID();
    const earlierId = randomUUID();
    const payoutAccount = (await context.pool.query("select payout_account_id from payout_accounts where user_id=$1", [booker.userId])).rows[0];
    const batch = {
      payoutId, sessionId, idempotencyKey: "current-key", requestedAt: endAt.toISOString(),
      destination: { payoutAccountId: payoutAccount.payout_account_id, userId: booker.userId, providerAccountReference: "provider", bankAccountReference: "bank" },
      lines: [{ ...a, ...first }, { ...b, ...second }].map((participant) => ({
        holdId: participant.holdId,
        participationId: participant.participationId,
        holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
        walletId: participant.walletId,
        amountCents: 500, kind: "RELEASE",
      })),
    };
    await context.pool.query(
      "update participations set attendance='ATTENDED',verified_at=$2,verification_method='BOOKER' where session_id=$1", [sessionId, endAt],
    );
    await context.pool.query(
      "update sessions set status='PAYOUT_PENDING',payout_attempt_ids=$2,payout_idempotency_keys=$3,pending_settlement=$4 where session_id=$1",
      [sessionId, [earlierId, payoutId], ["earlier-key", "current-key"], batch],
    );
    const loaded = await transaction().run(({ sessions }) => sessions.get(sessionId));
    expect(loaded?.participantList.participations.map((p) => p.participationId)).toEqual([a.participationId, b.participationId]);
    expect(loaded?.pendingSettlement?.lines.map((line) => line.amount.toCents())).toEqual([500, 500]);
    expect(loaded?.pendingSettlement?.requestedAt).toEqual(endAt);
    expect(loaded?.payoutAttemptIds).toEqual([earlierId, payoutId]);
    await context.pool.query("update sessions set status='AWAITING_PAYOUT',pending_settlement=null where session_id=$1", [sessionId]);
    const failed = await transaction().run(({ sessions }) => sessions.get(sessionId));
    expect(failed?.pendingSettlement).toBeUndefined();
    expect(failed?.payoutIdempotencyKeys).toEqual(["earlier-key", "current-key"]);
  });

  test("rejects malformed settlement JSON and hold ownership without writing visibility", async () => {
    const booker = await context.identity(false);
    const sessionId = await createSession(booker.userId);
    await context.pool.query("update sessions set pending_settlement='{}'::jsonb where session_id=$1", [sessionId]);
    await expect(change(booker.userId, sessionId, "PUBLIC")).rejects.toMatchObject({ name: "SessionPersistenceError" });
    await context.pool.query("update sessions set pending_settlement=null where session_id=$1", [sessionId]);
    const participant = await context.identity(false);
    const joined = await addParticipant(executor(), sessionId, participant);
    await context.pool.query("update fund_holds set wallet_id=$2 where hold_id=$1", [joined.holdId, booker.walletId]);
    await expect(change(booker.userId, sessionId, "PUBLIC")).rejects.toMatchObject({ name: "SessionPersistenceError" });
    expect((await context.pool.query("select visibility from sessions where session_id=$1", [sessionId])).rows)
      .toEqual([{ visibility: "PRIVATE" }]);
  });

  test("retries a final-slot serialization race and rechecks capacity from fresh state", async () => {
    const booker = await context.identity(false);
    const first = await context.identity(false);
    const last = await context.identity(false);
    const sessionId = await createSession(booker.userId);
    await addParticipant(executor(), sessionId, first);
    const committing = await context.pool.connect();
    let changing: Promise<unknown> | undefined;
    let attempts = 0;
    try {
      await committing.query("begin isolation level serializable");
      const sql: SqlExecutor = { query: async (statement, values) => (await committing.query(statement, values ? [...values] : undefined)).rows };
      const session = await new PostgresSessionManagementRepository(sql).get(sessionId);
      expect(session?.getAvailableSlots(now)).toBe(1);
      const pid = (await committing.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      changing = transaction().run(async ({ users, sessions }) => {
        attempts += 1;
        const user = await users.get(booker.userId);
        const loaded = await sessions.get(sessionId);
        if (!user || !loaded) throw new Error("Fixture is missing");
        user.asBooker().changeVisibility(loaded, "PUBLIC", now);
        await sessions.saveVisibility(loaded);
      }).then(() => null, (error: unknown) => error);
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting = (await context.pool.query(
          "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting", [pid],
        )).rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await addParticipant(sql, sessionId, last);
      await committing.query("commit");
      expect(await changing).toMatchObject({ code: "CAPACITY_EXCEEDED" });
      expect(attempts).toBeGreaterThanOrEqual(2);
      const final = await transaction().run(({ sessions }) => sessions.get(sessionId));
      expect(final?.getAvailableSlots(now)).toBe(0);
      expect(final?.visibility).toBe("PRIVATE");
    } finally {
      await committing.query("rollback");
      await changing;
      committing.release();
    }
  });
});
