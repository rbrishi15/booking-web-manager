import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Money, type UUID } from "@/domain";
import { NoDeliveryNotifier } from "@/lib/commit/no-delivery-notifier";
import { PostgresDueSessionQuery } from "@/lib/commit/postgres-due-session-query";
import { PostgresVerificationReminderQuery } from "@/lib/commit/postgres-verification-reminder-query";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresLedgerWriter } from "@/lib/money/ledger-write-adapter";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresCommitmentUnitOfWork } from "@/lib/sessions/postgres-commitment-unit-of-work";
import { AutoVerifyAttendance } from "@/use-cases/sessions/AutoVerifyAttendance";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { ExpireReplacements } from "@/use-cases/sessions/ExpireReplacements";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import { RunScheduledSessionJobs } from "@/use-cases/sessions/RunScheduledSessionJobs";
import { WithdrawFromSession } from "@/use-cases/sessions/WithdrawFromSession";

/**
 * Runs the scheduled commitment sweep, wired as in production, against a real
 * fully migrated database (through 0009 for verification_reminded_at).
 *
 * Skipped unless `COMMITMENT_TEST_DATABASE_URL` points at a throwaway
 * database, for example a local Supabase stack:
 *
 *   COMMITMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx vitest run --project unit tests/lib/commit/postgres-scheduled-jobs.db.test.ts
 *
 * The suite inserts its own users and sessions and never deletes. The sweep
 * only sees this suite's sessions, so other data in the database is untouched.
 */
const DATABASE_URL = process.env.COMMITMENT_TEST_DATABASE_URL;
const SHARE_CENTS = 500;
const HOUR = 3_600_000;
const startsAt = new Date(Date.now() + 7 * 24 * HOUR);
const endsAt = new Date(startsAt.getTime() + 2 * HOUR);
const beforeStart = (hours: number) => new Date(startsAt.getTime() - hours * HOUR);
const afterEnd = (hours: number) => new Date(endsAt.getTime() + hours * HOUR);

describe.skipIf(!DATABASE_URL)("scheduled commitment sweep (database)", () => {
  let pool: Pool;
  let sql: SqlExecutor;
  let holdingAccountId: UUID;
  let now = beforeStart(48);
  const clock = { now: () => now };
  const ids = { next: randomUUID };
  const notifier = new NoDeliveryNotifier();
  const ownSessions = new Set<UUID>();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    sql = { query: async (text, values) => (await pool.query(text, values ? [...values] : undefined)).rows };
    const rows = await pool.query(
      "insert into holding_accounts (label) values ($1) returning account_id",
      [`scheduler-test-${randomUUID()}`],
    );
    holdingAccountId = rows.rows[0].account_id;
  });
  afterAll(async () => pool?.end());
  beforeEach(() => {
    now = beforeStart(48);
  });

  test("a quiet session is never due", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker);
    await commit(alice, sessionId);

    for (const at of [beforeStart(48), beforeStart(-1), afterEnd(1)])
      expect(await due(at)).not.toContain(sessionId);
  });

  test("promotes a waiting participant into a freed place, then is no longer due", async () => {
    const [booker, alice = "", bob = "", carol = ""] = await createUsers(4);
    const sessionId = await createSession(booker);
    await commit(alice, sessionId);
    await commit(bob, sessionId);
    await commit(carol, sessionId);
    await withdrawWithoutPromotion(alice, sessionId);
    expect(await due(now)).toContain(sessionId);

    const report = await sweep().run(randomUUID());

    expect(report.failures).toEqual([]);
    expect(await statusOf(sessionId, carol)).toMatchObject({
      status: "COMMITTED",
      hold_state: "HELD",
    });
    expect(await due(now)).not.toContain(sessionId);
  });

  test("marks an unreplaced late withdrawal FORFEITURE_DUE at start, once", async () => {
    const [booker, alice = "", bob = ""] = await createUsers(3);
    const sessionId = await createSession(booker);
    await commit(alice, sessionId);
    await commit(bob, sessionId);
    now = beforeStart(10);
    await withdrawWithoutPromotion(alice, sessionId);
    expect(await statusOf(sessionId, alice)).toMatchObject({
      hold_state: "AWAITING_REPLACEMENT",
    });
    expect(await due(now)).not.toContain(sessionId);

    now = beforeStart(-0.5);
    expect(await due(now)).toContain(sessionId);
    const report = await sweep().run(randomUUID());

    expect(report.forfeitureDue).toContain(await participationIdOf(sessionId, alice));
    expect(await statusOf(sessionId, alice)).toMatchObject({
      hold_state: "FORFEITURE_DUE",
    });
    expect(await due(now)).not.toContain(sessionId);
  });

  test("auto-verifies attendance 72 hours after the end, not before", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker);
    await commit(alice, sessionId);

    expect(await due(afterEnd(71))).not.toContain(sessionId);
    now = afterEnd(72);
    expect(await due(now)).toContain(sessionId);
    const report = await sweep().run(randomUUID());

    expect(report.autoVerified).toContain(await participationIdOf(sessionId, alice));
    expect(await sessionStatus(sessionId)).toBe("AWAITING_PAYOUT");
    expect(await due(afterEnd(80))).not.toContain(sessionId);
  });

  test("claims each verification reminder once, and again after release", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker);
    const empty = await createSession(booker);
    await commit(alice, sessionId);
    const reminders = new PostgresVerificationReminderQuery(sql);

    expect(await claimed(reminders, beforeStart(1))).not.toContain(sessionId);
    const first = await reminders.claimVerificationReminders(afterEnd(1), 10_000);
    expect(first).toContainEqual({ sessionId, bookerId: booker });
    expect(first.map((reminder) => reminder.sessionId)).not.toContain(empty);
    expect(await claimed(reminders, afterEnd(2))).not.toContain(sessionId);

    await reminders.releaseVerificationReminders([sessionId]);

    expect(await claimed(reminders, afterEnd(3))).toContain(sessionId);
  });

  test("concurrent claims never return the same reminder twice", async () => {
    const [booker, ...participants] = await createUsers(6);
    const sessions: UUID[] = [];
    for (const participant of participants) {
      const sessionId = await createSession(booker);
      await commit(participant, sessionId);
      sessions.push(sessionId);
    }
    const reminders = new PostgresVerificationReminderQuery(sql);

    const claims = await Promise.all(
      Array.from({ length: 4 }, () => claimed(reminders, afterEnd(1))),
    );

    const ours = claims.flat().filter((id) => sessions.includes(id));
    expect(ours.sort()).toEqual([...sessions].sort());
  });

  function sweep(): RunScheduledSessionJobs {
    const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);
    const query = new PostgresDueSessionQuery(sql);
    return new RunScheduledSessionJobs({
      // Only this suite's sessions, so the sweep leaves other data alone.
      dueSessions: {
        dueSessionIds: async (at) =>
          (await query.dueSessionIds(at, 10_000)).filter((id) => ownSessions.has(id)),
      },
      verificationReminders: {
        claimVerificationReminders: async () => [],
        releaseVerificationReminders: async () => {},
      },
      notifier,
      expireReplacements: new ExpireReplacements({ unitOfWork, clock, notifier }),
      promote: new PromoteFromWaitlist({ unitOfWork, clock, ids, notifier }),
      autoVerify: new AutoVerifyAttendance({ unitOfWork, clock }),
      clock,
      batchSize: 10_000,
    });
  }

  async function due(at: Date): Promise<readonly UUID[]> {
    return new PostgresDueSessionQuery(sql).dueSessionIds(at, 10_000);
  }

  async function claimed(
    reminders: PostgresVerificationReminderQuery,
    at: Date,
  ): Promise<UUID[]> {
    return (await reminders.claimVerificationReminders(at, 10_000)).map(
      (reminder) => reminder.sessionId,
    );
  }

  async function commit(userId: UUID, sessionId: UUID) {
    const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);
    return new CommitToSession({ unitOfWork, clock, ids }).forParticipant({
      userId,
      sessionId,
      idempotencyKey: randomUUID(),
    });
  }

  /** Withdraws with the follow-up promotion failing, so it is left to the sweep. */
  async function withdrawWithoutPromotion(userId: UUID, sessionId: UUID) {
    const unitOfWork = new PostgresCommitmentUnitOfWork(() => pool, clock);
    const result = await new WithdrawFromSession({
      unitOfWork,
      clock,
      notifier,
      promote: {
        forSession: async () => {
          throw new Error("promotion deferred to the sweep");
        },
      },
    }).forParticipant({
      userId,
      sessionId,
      idempotencyKey: randomUUID(),
      replacement: { mode: "OPEN_SLOT" },
    });
    return result;
  }

  async function createUsers(count: number): Promise<[UUID, ...UUID[]]> {
    const users = Array.from({ length: count }, () => randomUUID());
    for (const id of users) {
      await pool.query(
        "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
        [id, `${id}@example.com`],
      );
      await new PostgresTransactor(pool).transaction(async (executor) => {
        const writer = new PostgresLedgerWriter(executor, `top-up-${id}`);
        await writer.creditTopUp({
          walletId: await writer.ensureWallet(id),
          amount: Money.fromCents(10_000),
          occurredAt: new Date(),
          externalReference: `test-${id}`,
        });
      });
    }
    return users as [UUID, ...UUID[]];
  }

  async function createSession(bookerId: UUID): Promise<UUID> {
    const sessionId = randomUUID();
    await pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport,
         start_at, end_at, total_cost_cents, total_slots, minimum_headcount,
         booking_share_cents, visibility, room_token, holding_account_id)
       values ($1, $2, 'Court', 'North', 'Badminton', $3, $4, $5, 2, 2, $6,
         'PUBLIC', $7, $8)`,
      [
        sessionId,
        bookerId,
        startsAt,
        endsAt,
        2 * SHARE_CENTS,
        SHARE_CENTS,
        randomUUID(),
        holdingAccountId,
      ],
    );
    ownSessions.add(sessionId);
    return sessionId;
  }

  async function statusOf(sessionId: UUID, userId: UUID) {
    const rows = await pool.query(
      `select p.status, h.state as hold_state from participations p
       left join fund_holds h on h.participation_id = p.participation_id
       where p.session_id = $1 and p.user_id = $2`,
      [sessionId, userId],
    );
    return rows.rows[0];
  }

  async function participationIdOf(sessionId: UUID, userId: UUID): Promise<UUID> {
    const rows = await pool.query(
      "select participation_id from participations where session_id = $1 and user_id = $2",
      [sessionId, userId],
    );
    return rows.rows[0].participation_id;
  }

  async function sessionStatus(sessionId: UUID): Promise<string> {
    const rows = await pool.query("select status from sessions where session_id = $1", [
      sessionId,
    ]);
    return rows.rows[0].status;
  }
});
