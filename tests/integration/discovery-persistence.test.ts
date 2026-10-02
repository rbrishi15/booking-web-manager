import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { toDiscoveryPage } from "@/app/discover/contracts";
import { parseDiscoveryQuery } from "@/app/discover/query";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionDiscoveryTransaction } from "@/lib/sessions/postgres-session-discovery-transaction";
import { DiscoverSessions, type SessionDiscoveryCriteria } from "@/use-cases/sessions/DiscoverSessions";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const now = new Date("2040-01-01T00:00:00Z");
const publicKeys = ["sessionId", "venueName", "region", "sport", "startAt", "endAt", "totalSlots", "bookingShareCents"].sort();

describe("UC2-01 PostgreSQL discovery", () => {
  let context: SessionTestContext;
  let bookerId: string;

  beforeAll(async () => {
    context = sessionTestContext();
    bookerId = (await context.identity(false)).userId;
  });
  afterAll(async () => {
    await context?.pool.end();
  });

  async function insertSession(input: {
    startAt: string;
    sessionId?: string;
    venueName?: string;
    sport?: string;
    region?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    status?: "OPEN" | "CANCELLED" | "AWAITING_PAYOUT" | "PAYOUT_PENDING" | "SETTLED";
  }) {
    const sessionId = input.sessionId ?? randomUUID();
    const endAt = new Date(new Date(input.startAt).getTime() + 2 * 60 * 60 * 1000);
    await context.pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
        total_cost_cents, total_slots, booking_share_cents, visibility, status,
        room_token, holding_account_id, minimum_reliability)
       values ($1,$2,$11,$3,$4,$5,$6,1001,2,500,$7,$8,$9,$10,100)`,
      [sessionId, bookerId, input.region ?? "West", input.sport ?? "Badminton", input.startAt, endAt,
        input.visibility ?? "PUBLIC", input.status ?? "OPEN", randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID,
        input.venueName ?? "Discovery fixture venue"],
    );
    return sessionId;
  }

  function discovery(at = now) {
    const clock = { now: () => at };
    return new DiscoverSessions({
      transaction: new PostgresSessionDiscoveryTransaction(() => context.pool, clock),
      clock,
    });
  }

  function discover(criteria: SessionDiscoveryCriteria = {}, at = now) {
    return discovery(at).forParticipant(bookerId, criteria);
  }

  test("loads current participant eligibility on every invocation", async () => {
    const participant = await context.identity(false);
    const useCase = discovery();
    await expect(useCase.forParticipant(participant.userId)).resolves.toEqual(expect.any(Array));

    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [participant.userId]);
    await expect(useCase.forParticipant(participant.userId)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    await expect(useCase.forParticipant(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("refuses discovery when the actor's complete User cannot be hydrated", async () => {
    const missing = await context.identity(false);
    await context.pool.query("delete from wallet_balances where wallet_id = $1", [missing.walletId]);
    await context.pool.query("delete from wallets where wallet_id = $1", [missing.walletId]);
    await expect(discovery().forParticipant(missing.userId)).rejects.toMatchObject({ name: "SessionPersistenceError" });

    const corrupt = await context.identity(false);
    await context.pool.query("update profiles set preferred_sports = '{\"\"}' where user_id = $1", [corrupt.userId]);
    await expect(discovery().forParticipant(corrupt.userId)).rejects.toMatchObject({ name: "SessionPersistenceError" });
  });

  test("allows an active participant with no payout setup, no available funds and low reliability to browse", async () => {
    const participant = await context.identity(false);
    const pastSession = await insertSession({ startAt: "2039-12-01T10:00:00Z" });
    const participationId = randomUUID();
    const holdId = randomUUID();
    await context.pool.query(
      `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, external_reference, wallet_id)
       values ('TOP_UP',500,'2039-11-30T09:00:00Z',$1,$2,$3)`,
      [randomUUID(), randomUUID(), participant.walletId],
    );
    await context.pool.query(
      `insert into participations (participation_id, session_id, user_id, status, attendance, committed_at, verified_at, verification_method)
       values ($1,$2,$3,'COMMITTED','ABSENT','2039-11-30T10:00:00Z','2039-12-01T12:00:00Z','BOOKER')`,
      [participationId, pastSession, participant.userId],
    );
    await context.pool.query(
      `insert into fund_holds (hold_id, participation_id, holding_account_id, wallet_id, amount_cents, state, created_at)
       values ($1,$2,$3,$4,500,'HELD','2039-11-30T10:00:00Z')`,
      [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, participant.walletId],
    );
    await context.pool.query(
      `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, wallet_id, hold_id, holding_account_id, session_id, participation_id)
       values ('LOCK',500,'2039-11-30T10:00:00Z',$1,$2,$3,$4,$5,$6)`,
      [randomUUID(), participant.walletId, holdId, PLATFORM_HOLDING_ACCOUNT_ID, pastSession, participationId],
    );
    const target = await insertSession({ startAt: "2040-06-08T10:00:00Z" });

    const result = await discovery().forParticipant(participant.userId, {
      startsWithin: { from: new Date("2040-06-08T00:00:00Z"), before: new Date("2040-06-09T00:00:00Z") },
    });
    expect(result.map((session) => session.sessionId)).toEqual([target]);
  });

  test("matches sport or venue case-insensitively while keeping other filters and exclusions", async () => {
    const startAt = "2040-06-05T10:00:00Z";
    const matchingSport = await insertSession({ startAt, sport: "Tennis" });
    const matchingVenue = await insertSession({ startAt, venueName: "TENNIS court centre" });
    await insertSession({ startAt, venueName: "Tennis east", region: "East" });
    await insertSession({ startAt, sport: "Tennis", visibility: "PRIVATE" });
    await insertSession({ startAt, sport: "Tennis", status: "CANCELLED" });
    await insertSession({ startAt: "2040-06-06T10:00:00Z", sport: "Tennis" });
    const filters = {
      text: "tenNIS", region: "West",
      startsWithin: { from: new Date("2040-06-05T00:00:00Z"), before: new Date("2040-06-06T00:00:00Z") },
    };
    expect((await discover(filters)).map((row) => row.sessionId)).toEqual([matchingSport, matchingVenue].sort());
    expect((await discover({ ...filters, sport: "Badminton" })).map((row) => row.sessionId)).toEqual([matchingVenue]);
    expect(await discover({ ...filters, text: "unmatched" })).toEqual([]);
  });

  test("treats wildcard characters, quotes, backslashes, and SQL fragments as literal search text", async () => {
    const startAt = "2040-06-07T10:00:00Z";
    const target = await insertSession({ startAt, venueName: "100%_O'Brien\\Court" });
    await insertSession({ startAt, venueName: "100X_O'BrienCourt" });
    await insertSession({ startAt, venueName: "100%XO'BrienCourt" });
    const filters = {
      startsWithin: { from: new Date("2040-06-07T00:00:00Z"), before: new Date("2040-06-08T00:00:00Z") },
    };
    for (const text of ["100%_", "O'Brien\\Court", "\\"]) {
      expect((await discover({ ...filters, text })).map((row) => row.sessionId)).toEqual([target]);
    }
    expect(await discover({ ...filters, text: "' OR true --" })).toEqual([]);
  });

  test("combines stored sport and region filters while excluding private and closed sessions", async () => {
    const startAt = "2040-06-01T10:00:00Z";
    const expected = await insertSession({ startAt });
    await insertSession({ startAt, region: "East" });
    await insertSession({ startAt, sport: "Tennis" });
    await insertSession({ startAt, visibility: "PRIVATE" });
    for (const status of ["CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"] as const) {
      await insertSession({ startAt, status });
    }

    const result = await discover({
      sport: "Badminton", region: "West",
      startsWithin: { from: new Date("2040-06-01T00:00:00Z"), before: new Date("2040-06-02T00:00:00Z") },
    });

    expect(result.map((session) => session.sessionId)).toEqual([expected]);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(publicKeys);
    expect(result[0]?.bookingShareCents).toBe(500);
    expect(result[0]?.startAt).toEqual(new Date(startAt));
    const injection = await discover({ sport: "Badminton' OR true --" });
    expect(injection).toEqual([]);
  });

  test("uses inclusive/exclusive start bounds and excludes exactly-now and already-started sessions", async () => {
    const lower = "2040-06-02T10:00:00Z";
    const upper = "2040-06-02T12:00:00Z";
    await insertSession({ startAt: "2040-06-02T09:30:00Z" }); // Overlaps, but starts outside the window.
    const first = await insertSession({ startAt: lower });
    const last = await insertSession({ startAt: "2040-06-02T11:59:59.999Z" });
    await insertSession({ startAt: upper });
    const filters = { startsWithin: { from: new Date(lower), before: new Date(upper) } };

    expect((await discover(filters)).map((session) => session.sessionId)).toEqual([first, last]);
    expect((await discover(filters, new Date(lower))).map((session) => session.sessionId)).toEqual([last]);
    expect(await discover(filters, new Date(upper))).toEqual([]);
  });

  test("returns all 41 matches ordered by start and tied session IDs without a page limit", async () => {
    const earlierIds = Array.from({ length: 21 }, () => randomUUID()).sort();
    const laterIds = Array.from({ length: 20 }, () => randomUUID()).sort();
    for (const [startAt, ids] of [
      ["2040-06-03T11:00:00Z", laterIds],
      ["2040-06-03T10:00:00Z", earlierIds],
    ] as const) {
      for (const sessionId of [...ids].reverse()) {
        await insertSession({ startAt, sessionId, venueName: "Ordered keyword venue" });
      }
    }
    await insertSession({ startAt: "2040-06-03T10:00:00Z", venueName: "Excluded venue" });
    const result = await discover({
      text: "KEYWORD",
      startsWithin: { from: new Date("2040-06-03T00:00:00Z"), before: new Date("2040-06-04T00:00:00Z") },
    });

    expect(result).toHaveLength(41);
    expect(result.map((session) => session.sessionId)).toEqual([...earlierIds, ...laterIds]);
  });

  test("pages sessions with sub-millisecond start differences exactly once at Date precision", async () => {
    // Arrange: PostgreSQL timestamp order is the reverse of the cursor's tied-ID order.
    const expectedIds = Array.from({ length: 21 }, () => randomUUID()).sort();
    const venueName = `Microsecond discovery ${randomUUID()}`;
    for (const [index, sessionId] of [...expectedIds].reverse().entries()) {
      await insertSession({
        sessionId,
        venueName,
        startAt: `2040-06-09T10:00:00.123${String(index + 1).padStart(3, "0")}Z`,
      });
    }

    // Act: follow the real app cursor through a second complete discovery read.
    const result = await discover({ text: venueName });
    const firstPage = toDiscoveryPage(result);
    expect(firstPage.nextCursor).not.toBeNull();
    const nextQuery = parseDiscoveryQuery(new URLSearchParams({
      q: venueName,
      cursor: firstPage.nextCursor ?? "",
    }));
    if (nextQuery.status !== "valid") throw new Error("Expected a valid discovery continuation");
    const secondPage = toDiscoveryPage(await discover(nextQuery.criteria), nextQuery.after);

    // Assert
    expect(result.map((session) => session.sessionId)).toEqual(expectedIds);
    expect(result.map((session) => session.startAt.toISOString())).toEqual(
      expectedIds.map(() => "2040-06-09T10:00:00.123Z"),
    );
    expect([firstPage.items.length, secondPage.items.length]).toEqual([20, 1]);
    expect([...firstPage.items, ...secondPage.items].map((session) => session.sessionId))
      .toEqual(expectedIds);
    expect(secondPage.nextCursor).toBeNull();
  });

  test("includes full sessions with reliability requirements without reading private participation facts", async () => {
    const sessionId = await insertSession({ startAt: "2040-06-04T10:00:00Z" });
    for (let index = 0; index < 2; index += 1) {
      const participant = await context.identity(false);
      const participationId = randomUUID();
      const holdId = randomUUID();
      await context.pool.query(
        `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, external_reference, wallet_id)
         values ('TOP_UP',500,$1,$2,$3,$4)`,
        [now, randomUUID(), randomUUID(), participant.walletId],
      );
      await context.pool.query(
        `insert into participations (participation_id, session_id, user_id, status, attendance, committed_at)
         values ($1,$2,$3,'COMMITTED','UNVERIFIED',$4)`,
        [participationId, sessionId, participant.userId, now],
      );
      await context.pool.query(
        `insert into fund_holds (hold_id, participation_id, holding_account_id, wallet_id, amount_cents, state, created_at)
         values ($1,$2,$3,$4,500,'HELD',$5)`,
        [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, participant.walletId, now],
      );
      await context.pool.query(
        `insert into ledger_entries (kind, amount_cents, occurred_at, idempotency_key, wallet_id, hold_id, holding_account_id, session_id, participation_id)
         values ('LOCK',500,$1,$2,$3,$4,$5,$6,$7)`,
        [now, randomUUID(), participant.walletId, holdId, PLATFORM_HOLDING_ACCOUNT_ID, sessionId, participationId],
      );
    }

    const result = await discover({
      startsWithin: { from: new Date("2040-06-04T00:00:00Z"), before: new Date("2040-06-05T00:00:00Z") },
    });
    expect(result.map((session) => session.sessionId)).toEqual([sessionId]);
    expect(result[0]?.totalSlots).toBe(2);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(publicKeys);
  });
});
