import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Money, type Session, type UUID } from "@/domain";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresLedgerWriter } from "@/lib/money/ledger-write-adapter";
import { PostgresCommitmentUnitOfWork } from "@/lib/sessions/postgres-commitment-unit-of-work";
import type { DomainTransaction } from "@/use-cases/shared/contracts";

/**
 * Runs the commitment unit of work against a real, fully migrated database:
 * real SQL, constraints, ledger triggers, row locks and serializable retries.
 *
 * Skipped unless `COMMITMENT_TEST_DATABASE_URL` points at a throwaway database
 * with every migration applied, for example a local Supabase stack:
 *
 *   COMMITMENT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx vitest run --project unit tests/lib/sessions/postgres-commitment-unit-of-work.db.test.ts
 *
 * The suite inserts its own users, holding account and sessions and never
 * deletes, so point it only at a disposable database.
 */
const DATABASE_URL = process.env.COMMITMENT_TEST_DATABASE_URL;
const SHARE_CENTS = 500;
const startsAt = new Date(Date.now() + 7 * 24 * 3_600_000);
const hoursBeforeStart = (hours: number) =>
  new Date(startsAt.getTime() - hours * 3_600_000);

describe.skipIf(!DATABASE_URL)("PostgresCommitmentUnitOfWork (database)", () => {
  let pool: Pool;
  let holdingAccountId: UUID;
  let now = hoursBeforeStart(48);
  const clock = { now: () => now };
  const unitOfWork = () => new PostgresCommitmentUnitOfWork(() => pool, clock);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 25 });
    const rows = await pool.query(
      "insert into holding_accounts (label) values ($1) returning account_id",
      [`commitment-test-${randomUUID()}`],
    );
    holdingAccountId = rows.rows[0].account_id;
  });
  afterAll(async () => pool?.end());
  beforeEach(() => {
    now = hoursBeforeStart(48);
  });

  test("commits a participant: participation, hold and LOCK are stored together", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker, 2);

    const result = await commit(alice, sessionId, "commit-alice");

    expect(result).toEqual({ kind: "COMMITTED" });
    expect(await participationOf(sessionId, alice)).toMatchObject({
      status: "COMMITTED",
      hold_state: "HELD",
    });
    expect(await availableCents(alice)).toBe(10_000 - SHARE_CENTS);
  });

  test("replays a repeated key without locking funds again", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker, 2);
    await commit(alice, sessionId, "commit-alice");

    const replay = await commit(alice, sessionId, "commit-alice");

    expect(replay).toEqual({ kind: "COMMITTED" });
    expect(await availableCents(alice)).toBe(10_000 - SHARE_CENTS);
  });

  test("rolls back the session change when the work fails after saving", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const sessionId = await createSession(booker, 2);

    await expect(
      unitOfWork().execute(key("fail", sessionId), async (transaction) => {
        await join(transaction, alice, sessionId);
        throw new Error("fail after save");
      }),
    ).rejects.toThrow("fail after save");

    expect(await participationOf(sessionId, alice)).toBeUndefined();
    expect(await availableCents(alice)).toBe(10_000);
  });

  test("a late withdrawal, then promotion, refunds the withdrawer and locks the entrant", async () => {
    const [booker, alice = "", bob = "", carol = ""] = await createUsers(4);
    const sessionId = await createSession(booker, 2);
    await commit(alice, sessionId, "commit-alice");
    await commit(bob, sessionId, "commit-bob");
    expect(await commit(carol, sessionId, "commit-carol")).toEqual({
      kind: "WAITLISTED",
    });
    now = hoursBeforeStart(10);

    await unitOfWork().execute(key("withdraw", alice), async (transaction) => {
      const { user, session } = await load(transaction, alice, sessionId);
      const participation = session.participantList.findByUserId(alice);
      if (!participation) throw new Error("alice is not participating");
      const result = user.asParticipant().withdraw(session, {
        participationId: participation.participationId,
        now,
      });
      await transaction.sessions.save(session);
      await transaction.ledger.append(result.instructions);
    });
    await unitOfWork().execute(key("promote", sessionId), async (transaction) => {
      const { user, session } = await load(transaction, carol, sessionId);
      const result = user
        .asParticipant()
        .promoteFromWaitlist(session, { holdId: randomUUID(), now });
      await transaction.sessions.save(session);
      await transaction.ledger.append(result.instructions);
    });

    expect(await participationOf(sessionId, alice)).toMatchObject({
      status: "WITHDRAWN",
      hold_state: "REFUNDED",
    });
    expect(await participationOf(sessionId, carol)).toMatchObject({
      status: "COMMITTED",
      hold_state: "HELD",
    });
    expect(await availableCents(alice)).toBe(10_000);
    expect(await availableCents(carol)).toBe(10_000 - SHARE_CENTS);
  });

  test("concurrency: one wallet committing to two sessions at once can fund only one", async () => {
    const [booker, alice = ""] = await createUsers(2);
    const first = await createSession(booker, 2, 6_000);
    const second = await createSession(booker, 2, 6_000);

    const outcomes = await Promise.allSettled([
      commit(alice, first, "commit-first"),
      commit(alice, second, "commit-second"),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      name: "DomainError",
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await availableCents(alice)).toBe(10_000 - 6_000);
  });

  test("concurrency: 20 concurrent commits on an 8-slot session — exactly 8 succeed, 12 waitlist, total locked = 8 × share", async () => {
    const [booker, ...participants] = await createUsers(21);
    const sessionId = await createSession(booker, 8);
    const share = Math.floor(10_000 / 8);

    const results = await Promise.all(
      participants.map((userId) => commit(userId, sessionId, `commit-${userId}`)),
    );

    expect(results.filter((r) => r.kind === "COMMITTED")).toHaveLength(8);
    expect(results.filter((r) => r.kind === "WAITLISTED")).toHaveLength(12);
    const held = await pool.query(
      `select coalesce(sum(h.amount_cents), 0)::bigint as total, count(*)::int as holds
       from fund_holds h join participations p on p.participation_id = h.participation_id
       where p.session_id = $1 and h.state = 'HELD'`,
      [sessionId],
    );
    expect(held.rows[0]).toEqual({ total: String(8 * share), holds: 8 });
  });

  async function createUsers(count: number): Promise<[UUID, ...UUID[]]> {
    const ids = Array.from({ length: count }, () => randomUUID());
    for (const id of ids) {
      await pool.query("insert into auth.users (id, email) values ($1, $2)", [
        id,
        `${id}@example.com`,
      ]);
      await new PostgresTransactor(pool).transaction(async (sql) => {
        const writer = new PostgresLedgerWriter(sql, `top-up-${id}`);
        await writer.creditTopUp({
          walletId: await writer.ensureWallet(id),
          amount: Money.fromCents(10_000),
          occurredAt: new Date(),
          externalReference: `test-${id}`,
        });
      });
    }
    return ids as [UUID, ...UUID[]];
  }

  async function createSession(
    bookerId: UUID,
    totalSlots: number,
    shareCents = totalSlots === 2 ? SHARE_CENTS : Math.floor(10_000 / totalSlots),
  ): Promise<UUID> {
    const sessionId = randomUUID();
    const totalCost = shareCents * totalSlots;
    await pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport,
         start_at, end_at, total_cost_cents, total_slots, minimum_headcount,
         booking_share_cents, visibility, room_token, holding_account_id)
       values ($1, $2, 'Court', 'North', 'Badminton', $3, $4, $5, $6, 2, $7,
         'PUBLIC', $8, $9)`,
      [
        sessionId,
        bookerId,
        startsAt,
        new Date(startsAt.getTime() + 2 * 3_600_000),
        totalCost,
        totalSlots,
        Math.floor(totalCost / totalSlots),
        randomUUID(),
        holdingAccountId,
      ],
    );
    return sessionId;
  }

  function key(...parts: string[]): string {
    return JSON.stringify(["commitment-db-test", ...parts, randomUUID()]);
  }

  async function load(transaction: DomainTransaction, userId: UUID, sessionId: UUID) {
    const user = await transaction.users.get(userId);
    const session = await transaction.sessions.get(sessionId);
    if (!user || !session) throw new Error("fixture not found");
    return { user, session: session as Session };
  }

  async function join(transaction: DomainTransaction, userId: UUID, sessionId: UUID) {
    const { user, session } = await load(transaction, userId, sessionId);
    const result = user.asParticipant().join(session, {
      participationId: randomUUID(),
      holdId: randomUUID(),
      now,
    });
    await transaction.sessions.save(session);
    await transaction.ledger.append(result.instructions);
    return result;
  }

  function commit(userId: UUID, sessionId: UUID, submission: string) {
    return unitOfWork().execute(
      JSON.stringify(["UC2-04", userId, sessionId, submission]),
      async (transaction) => ({
        kind: (await join(transaction, userId, sessionId)).kind,
      }),
    );
  }

  async function participationOf(sessionId: UUID, userId: UUID) {
    const rows = await pool.query(
      `select p.status, h.state as hold_state from participations p
       left join fund_holds h on h.participation_id = p.participation_id
       where p.session_id = $1 and p.user_id = $2`,
      [sessionId, userId],
    );
    return rows.rows[0];
  }

  async function availableCents(userId: UUID): Promise<number> {
    const rows = await pool.query(
      `select b.available_cents from wallet_balances b
       join wallets w on w.wallet_id = b.wallet_id where w.user_id = $1`,
      [userId],
    );
    return Number(rows.rows[0].available_cents);
  }
});
