import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionCreationTransaction } from "@/lib/sessions/postgres-session-creation-transaction";
import {
  CreateSessions,
  type SessionBooking,
  type SessionConfig,
} from "@/use-cases/sessions/CreateSessions";
import type { SessionCreationTransaction } from "@/use-cases/sessions/session-creation-transaction";
import {
  localSupabaseTestContext,
  prepareEligibleBooker,
  type LocalSupabaseTestContext,
} from "../support/local-supabase";

const now = new Date("2026-10-01T10:00:00Z");
const clock = { now: () => new Date(now) };

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 PostgreSQL session creation", () => {
  let context: LocalSupabaseTestContext;

  beforeAll(() => {
    context = localSupabaseTestContext();
  });

  afterAll(async () => {
    await context?.pool.end();
  });

  test("stores the domain-created session and its replay result without financial effects", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();
    const transaction = transactionFor(context, submissionKey);
    const createSessions = creationWith(transaction);
    const invitedGroupId = randomUUID();

    // Act
    const created = await createSessions.forBooker(booker.userId, booking(), {
      totalSlots: 3,
      minimumHeadcount: 2,
      visibility: "PUBLIC",
      minimumReliability: 75.5,
      invitedGroupId,
    });

    // Assert
    expect(created.bookingShareCents).toBe(333);
    const stored = await context.pool.query(
      `select session_id, booker_id, total_cost_cents, booking_share_cents,
              total_slots, minimum_headcount, visibility, minimum_reliability,
              room_token, holding_account_id, invited_group_id, status
         from public.sessions where session_id = $1`,
      [created.sessionId],
    );
    expect(stored.rows).toEqual([
      {
        session_id: created.sessionId,
        booker_id: booker.userId,
        total_cost_cents: "1001",
        booking_share_cents: "333",
        total_slots: 3,
        minimum_headcount: 2,
        visibility: "PUBLIC",
        minimum_reliability: "75.5",
        room_token: created.roomToken,
        holding_account_id: PLATFORM_HOLDING_ACCOUNT_ID,
        invited_group_id: invitedGroupId,
        status: "OPEN",
      },
    ]);
    const replay = await context.pool.query(
      "select status from public.idempotency_keys where idempotency_key = $1",
      [operationKey(booker.userId, submissionKey)],
    );
    expect(replay.rows).toEqual([{ status: "SUCCEEDED" }]);
    const effects = await context.pool.query(
      `select
         (select count(*)::integer from public.ledger_entries where wallet_id = $1 or session_id = $2) as ledger_entries,
         (select count(*)::integer from public.participations where session_id = $2) as participations,
         (select count(*)::integer from public.payout_payables where session_id = $2) as payouts`,
      [booker.walletId, created.sessionId],
    );
    expect(effects.rows).toEqual([
      { ledger_entries: 0, participations: 0, payouts: 0 },
    ]);
  });

  test("hydrates complete wallet history, memberships, and attendance-derived reliability", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    await context.pool.query(
      "update public.profiles set preferred_sports = '{Badminton}', preferred_regions = '{West}' where user_id = $1",
      [booker.userId],
    );
    await context.pool.query(
      `insert into public.ledger_entries
         (kind, amount_cents, occurred_at, idempotency_key, external_reference, wallet_id)
       select 'TOP_UP', 100, '2026-09-20T10:00:00Z', $2 || '-' || n, $2 || '-provider-' || n, $1
         from generate_series(1, 205) as n`,
      [booker.walletId, randomUUID()],
    );
    const groupId = randomUUID();
    await context.pool.query(
      `insert into public.regular_groups
         (group_id, owner_id, name, invitation_token, invitation_active, status)
       values ($1, $2, 'Session integration group', $3, true, 'ACTIVE')`,
      [groupId, booker.userId, randomUUID()],
    );
    await context.pool.query(
      "insert into public.group_memberships (group_id, user_id, joined_at) values ($1, $2, $3)",
      [groupId, booker.userId, now],
    );
    await seedAttendance(context, booker, "ATTENDED");
    await seedAttendance(context, booker, "ABSENT");

    // Act
    const hydrated = await transactionFor(context, randomUUID()).runForBooker(
      booker.userId,
      async ({ users }) => {
        const user = await users.get(booker.userId);
        if (!user) throw new Error("Expected the provisioned test user");
        return {
          userId: user.userId,
          email: user.email?.toString(),
          walletId: user.wallet.walletId,
          historyLength: user.wallet.transactions.length,
          availableCents: user.wallet.getAvailableBalance().toCents(),
          reliability: user.reliabilityScore.toNumber(),
          memberships: user.memberGroupIds,
          sports: [...user.preferredSports],
          regions: [...user.preferredRegions],
          payoutStatus: user.payoutAccount?.setupStatus,
        };
      },
    );

    // Assert
    expect(hydrated).toEqual({
      userId: booker.userId,
      email: booker.email,
      walletId: booker.walletId,
      historyLength: 207,
      availableCents: 19_834,
      reliability: 50,
      memberships: [groupId],
      sports: ["Badminton"],
      regions: ["West"],
      payoutStatus: "COMPLETE",
    });
  });

  test("serializes simultaneous retries into one committed session", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();

    // Act
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        creationWith(transactionFor(context, submissionKey)).forBooker(
          booker.userId,
          booking(),
          config(),
        ),
      ),
    );

    // Assert
    expect(results).toHaveLength(8);
    for (const result of results) expect(result).toEqual(results[0]);
    const rows = await context.pool.query(
      "select session_id from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(rows.rows).toEqual([{ session_id: results[0]?.sessionId }]);
  });

  test("rejects a stored user missing their required wallet without committing creation", async () => {
    // Arrange: remove only this newly created fixture's empty wallet.
    const booker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();
    await context.pool.query(
      "delete from public.wallet_balances where wallet_id = $1",
      [booker.walletId],
    );
    await context.pool.query(
      "delete from public.wallets where wallet_id = $1",
      [booker.walletId],
    );

    // Act & Assert
    await expect(
      creationWith(transactionFor(context, submissionKey)).forBooker(
        booker.userId,
        booking(),
        config(),
      ),
    ).rejects.toMatchObject({ name: "SessionPersistenceError" });
    const committed = await context.pool.query(
      `select
         (select count(*)::integer from public.sessions where booker_id = $1) as sessions,
         (select count(*)::integer from public.idempotency_keys where idempotency_key = $2) as replay_results`,
      [booker.userId, operationKey(booker.userId, submissionKey)],
    );
    expect(committed.rows).toEqual([{ sessions: 0, replay_results: 0 }]);
  });

  test("replays original data when a successful key is reused with changed valid choices", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();
    const original = await creationWith(
      transactionFor(context, submissionKey),
    ).forBooker(booker.userId, booking(), config());

    // Act
    const replay = await creationWith(
      transactionFor(context, submissionKey),
    ).forBooker(booker.userId, booking(), {
      totalSlots: 2,
      minimumHeadcount: 2,
    });

    // Assert
    expect(replay).toEqual(original);
    expect(replay.bookingShareCents).toBe(333);
    const rows = await context.pool.query(
      "select total_slots from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(rows.rows).toEqual([{ total_slots: 3 }]);
  });

  test("isolates the same submission key between two bookers", async () => {
    // Arrange
    const firstBooker = await prepareEligibleBooker(context);
    const secondBooker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();

    // Act
    const first = await creationWith(
      transactionFor(context, submissionKey),
    ).forBooker(firstBooker.userId, booking(), config());
    const second = await creationWith(
      transactionFor(context, submissionKey),
    ).forBooker(secondBooker.userId, booking(), config());

    // Assert
    expect(second.sessionId).not.toBe(first.sessionId);
    const rows = await context.pool.query(
      "select session_id, booker_id from public.sessions where session_id = any($1::uuid[])",
      [[first.sessionId, second.sessionId]],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { session_id: first.sessionId, booker_id: firstBooker.userId },
        { session_id: second.sessionId, booker_id: secondBooker.userId },
      ]),
    );
  });

  test("rolls back a staged session and replay claim when work fails, allowing retry", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const submissionKey = randomUUID();
    const transaction = transactionFor(context, submissionKey);
    const failingWork: SessionCreationTransaction = {
      runForBooker: (userId, work) =>
        transaction.runForBooker(userId, async (repositories) => {
          await work(repositories);
          throw new Error("Test failure after the session insert");
        }),
    };

    // Act & Assert
    await expect(
      creationWith(failingWork).forBooker(booker.userId, booking(), config()),
    ).rejects.toThrow("Test failure after the session insert");
    const rolledBack = await context.pool.query(
      `select
         (select count(*)::integer from public.sessions where booker_id = $1) as sessions,
         (select count(*)::integer from public.idempotency_keys where idempotency_key = $2) as replay_results`,
      [booker.userId, operationKey(booker.userId, submissionKey)],
    );
    expect(rolledBack.rows).toEqual([{ sessions: 0, replay_results: 0 }]);

    // Act
    const retry = await creationWith(
      transactionFor(context, submissionKey),
    ).forBooker(booker.userId, booking(), config());

    // Assert
    expect(retry.bookingShareCents).toBe(333);
    const stored = await context.pool.query(
      "select session_id from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(stored.rows).toEqual([{ session_id: retry.sessionId }]);
  });

  test("enforces capacity and calculated-share constraints in PostgreSQL", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const created = await creationWith(
      transactionFor(context, randomUUID()),
    ).forBooker(booker.userId, booking(), config());

    // Act & Assert
    await expect(
      context.pool.query(
        "update public.sessions set total_slots = 9, booking_share_cents = 111 where session_id = $1",
        [created.sessionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      context.pool.query(
        "update public.sessions set booking_share_cents = 334 where session_id = $1",
        [created.sessionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const stored = await context.pool.query(
      "select total_slots, booking_share_cents from public.sessions where session_id = $1",
      [created.sessionId],
    );
    expect(stored.rows).toEqual([
      { total_slots: 3, booking_share_cents: "333" },
    ]);
  });

  test("denies direct browser-role reads and writes of private session data", async () => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const created = await creationWith(
      transactionFor(context, randomUUID()),
    ).forBooker(booker.userId, booking(), config());

    // Act & Assert
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        withBrowserRole(context, role, booker.userId, (client) =>
          client.query(
            "select room_token from public.sessions where session_id = $1",
            [created.sessionId],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withBrowserRole(context, role, booker.userId, (client) =>
          client.query(
            "update public.sessions set visibility = 'PUBLIC' where session_id = $1",
            [created.sessionId],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withBrowserRole(context, role, booker.userId, (client) =>
          client.query(
            "select response from public.idempotency_keys where idempotency_key = $1",
            [operationKey(booker.userId, "not-a-real-submission")],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const security = await context.pool.query(
      `select relname, relrowsecurity from pg_class
        where oid in ('public.sessions'::regclass, 'public.payout_accounts'::regclass,
          'public.regular_groups'::regclass, 'public.group_memberships'::regclass,
          'public.participations'::regclass, 'public.fund_holds'::regclass)`,
    );
    expect(security.rows).toHaveLength(6);
    for (const table of security.rows) expect(table.relrowsecurity).toBe(true);
  });
});

function transactionFor(
  context: LocalSupabaseTestContext,
  idempotencyKey: string,
) {
  return new PostgresSessionCreationTransaction(
    context.pool,
    { idempotencyKey },
    clock,
  );
}

function creationWith(transaction: SessionCreationTransaction) {
  return new CreateSessions({
    transaction,
    clock,
    ids: { next: randomUUID },
    holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
  });
}

function booking(): SessionBooking {
  return {
    venueName: "Jurong East Sports Hall",
    region: "West",
    sport: "Badminton",
    startAt: new Date("2026-10-03T10:00:00Z"),
    endAt: new Date("2026-10-03T12:00:00Z"),
    totalCostCents: 1001,
  };
}

function config(): SessionConfig {
  return { totalSlots: 3, minimumHeadcount: 2 };
}

function operationKey(userId: string, idempotencyKey: string): string {
  return JSON.stringify(["UC2-02", userId, idempotencyKey]);
}

async function withBrowserRole<T>(
  context: LocalSupabaseTestContext,
  role: "anon" | "authenticated",
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await context.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      role === "anon" ? "set local role anon" : "set local role authenticated",
    );
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    return await work(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

async function seedAttendance(
  context: LocalSupabaseTestContext,
  booker: { userId: string; walletId: string },
  attendance: "ATTENDED" | "ABSENT",
) {
  const sessionId = randomUUID();
  const participationId = randomUUID();
  const holdId = randomUUID();
  await context.pool.query(
    `insert into public.sessions
       (session_id, booker_id, venue_name, region, sport, start_at, end_at,
        total_cost_cents, total_slots, minimum_headcount, booking_share_cents,
        room_token, holding_account_id)
     values ($1, $2, 'Past court', 'West', 'Badminton', '2026-09-29T10:00:00Z',
       '2026-09-29T12:00:00Z', 666, 2, 2, 333, $3, $4)`,
    [sessionId, booker.userId, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
  await context.pool.query(
    `insert into public.participations
       (participation_id, session_id, user_id, status, attendance, committed_at, verified_at, verification_method)
     values ($1, $2, $3, 'COMMITTED', $4, '2026-09-28T10:00:00Z', '2026-09-30T10:00:00Z', 'BOOKER')`,
    [participationId, sessionId, booker.userId, attendance],
  );
  await context.pool.query(
    `insert into public.fund_holds
       (hold_id, participation_id, holding_account_id, wallet_id, amount_cents, state, created_at)
     values ($1, $2, $3, $4, 333, 'HELD', '2026-09-28T10:00:00Z')`,
    [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, booker.walletId],
  );
  await context.pool.query(
    `insert into public.ledger_entries
       (kind, amount_cents, occurred_at, idempotency_key, wallet_id, hold_id,
        holding_account_id, session_id, participation_id)
     values ('LOCK', 333, '2026-09-28T10:00:00Z', $1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      booker.walletId,
      holdId,
      PLATFORM_HOLDING_ACCOUNT_ID,
      sessionId,
      participationId,
    ],
  );
}
