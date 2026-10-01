import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresSessionDiscoveryReader } from "@/lib/sessions/postgres-session-discovery-reader";
import { DiscoverSessions, type DiscoverSessionsInput } from "@/use-cases/sessions/DiscoverSessions";
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
        total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, status,
        room_token, holding_account_id, minimum_reliability)
       values ($1,$2,$11,$3,$4,$5,$6,1001,2,2,500,$7,$8,$9,$10,100)`,
      [sessionId, bookerId, input.region ?? "West", input.sport ?? "Badminton", input.startAt, endAt,
        input.visibility ?? "PUBLIC", input.status ?? "OPEN", randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID,
        input.venueName ?? "Discovery fixture venue"],
    );
    return sessionId;
  }

  function discover(input: DiscoverSessionsInput = {}, at = now) {
    return new PostgresTransactor(context.pool).transaction((sql) =>
      new DiscoverSessions({
        reader: new PostgresSessionDiscoveryReader(sql),
        clock: { now: () => at },
      }).search(input),
    );
  }

  test("matches sport or venue case-insensitively while keeping other filters and exclusions", async () => {
    const startAt = "2040-06-05T10:00:00Z";
    const matchingSport = await insertSession({ startAt, sport: "Tennis" });
    const matchingVenue = await insertSession({ startAt, venueName: "TENNIS court centre" });
    await insertSession({ startAt, venueName: "Tennis east", region: "East" });
    await insertSession({ startAt, sport: "Tennis", visibility: "PRIVATE" });
    await insertSession({ startAt, sport: "Tennis", status: "CANCELLED" });
    await insertSession({ startAt: "2040-06-06T10:00:00Z", sport: "Tennis" });
    const filters = {
      q: "tenNIS", region: "West",
      startAtFrom: new Date("2040-06-05T00:00:00Z"), startAtBefore: new Date("2040-06-06T00:00:00Z"),
    };
    expect((await discover(filters)).items.map((row) => row.sessionId)).toEqual([matchingSport, matchingVenue].sort());
    expect((await discover({ ...filters, sport: "Badminton" })).items.map((row) => row.sessionId)).toEqual([matchingVenue]);
    expect((await discover({ ...filters, q: "unmatched" })).items).toEqual([]);
  });

  test("treats wildcard characters, quotes, backslashes, and SQL fragments as literal search text", async () => {
    const startAt = "2040-06-07T10:00:00Z";
    const target = await insertSession({ startAt, venueName: "100%_O'Brien\\Court" });
    await insertSession({ startAt, venueName: "100X_O'BrienCourt" });
    await insertSession({ startAt, venueName: "100%XO'BrienCourt" });
    const filters = {
      startAtFrom: new Date("2040-06-07T00:00:00Z"), startAtBefore: new Date("2040-06-08T00:00:00Z"),
    };
    for (const q of ["100%_", "O'Brien\\Court", "\\"]) {
      expect((await discover({ ...filters, q })).items.map((row) => row.sessionId)).toEqual([target]);
    }
    expect((await discover({ ...filters, q: "' OR true --" })).items).toEqual([]);
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
      startAtFrom: new Date("2040-06-01T00:00:00Z"),
      startAtBefore: new Date("2040-06-02T00:00:00Z"),
    });

    expect(result.items.map((session) => session.sessionId)).toEqual([expected]);
    expect(result.nextCursor).toBeNull();
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(publicKeys);
    expect(result.items[0]?.bookingShareCents).toBe(500);
    expect(result.items[0]?.startAt).toEqual(new Date(startAt));
    const injection = await discover({ sport: "Badminton' OR true --" });
    expect(injection.items).toEqual([]);
  });

  test("uses inclusive/exclusive start bounds and excludes exactly-now and already-started sessions", async () => {
    const lower = "2040-06-02T10:00:00Z";
    const upper = "2040-06-02T12:00:00Z";
    await insertSession({ startAt: "2040-06-02T09:30:00Z" }); // Overlaps, but starts outside the window.
    const first = await insertSession({ startAt: lower });
    const last = await insertSession({ startAt: "2040-06-02T11:59:59.999Z" });
    await insertSession({ startAt: upper });
    const filters = { startAtFrom: new Date(lower), startAtBefore: new Date(upper) };

    expect((await discover(filters)).items.map((session) => session.sessionId)).toEqual([first, last]);
    expect((await discover(filters, new Date(lower))).items.map((session) => session.sessionId)).toEqual([last]);
    expect((await discover(filters, new Date(upper))).items).toEqual([]);
  });

  test("paginates tied starts by session ID without repeating or skipping a result", async () => {
    const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
    for (const sessionId of [...ids].reverse()) {
      await insertSession({ startAt: "2040-06-03T10:00:00Z", sessionId, venueName: "Paged keyword venue" });
    }
    await insertSession({ startAt: "2040-06-03T10:00:00Z", venueName: "Excluded venue" });
    const filters = {
      q: "KEYWORD",
      startAtFrom: new Date("2040-06-03T00:00:00Z"),
      startAtBefore: new Date("2040-06-04T00:00:00Z"),
    };

    const first = await discover(filters);
    expect(first.items.map((session) => session.sessionId)).toEqual(ids.slice(0, 20));
    expect(first.nextCursor).toEqual({ startAt: "2040-06-03T10:00:00.000Z", sessionId: ids[19] });
    if (first.nextCursor === null) throw new Error("Expected another discovery page");
    const second = await discover({ ...filters, cursor: first.nextCursor });
    expect(second.items.map((session) => session.sessionId)).toEqual(ids.slice(20));
    expect(second.nextCursor).toBeNull();
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
      startAtFrom: new Date("2040-06-04T00:00:00Z"), startAtBefore: new Date("2040-06-05T00:00:00Z"),
    });
    expect(result.items.map((session) => session.sessionId)).toEqual([sessionId]);
    expect(result.items[0]?.totalSlots).toBe(2);
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(publicKeys);
  });
});
