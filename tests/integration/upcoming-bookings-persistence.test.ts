import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresUpcomingBookingsReader } from "@/lib/sessions/postgres-upcoming-bookings-reader";
import { ListUpcomingBookings } from "@/use-cases/sessions/ListUpcomingBookings";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const now = new Date("2042-01-01T00:00:00Z");
type ParticipationStatus = "COMMITTED" | "WAITLISTED" | "LEFT_WAITLIST" | "WITHDRAWN" | "REMOVED" | "CANCELLED";

describe("PostgreSQL personal upcoming bookings", () => {
  let context: SessionTestContext;
  let otherBookerId: string;

  beforeAll(async () => {
    context = sessionTestContext();
    otherBookerId = (await context.identity(false)).userId;
  });
  afterAll(async () => {
    await context?.pool.end();
  });

  async function insertSession(input: {
    sessionId?: string;
    bookerId?: string;
    startAt?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    status?: "OPEN" | "CANCELLED" | "AWAITING_PAYOUT" | "PAYOUT_PENDING" | "SETTLED";
  } = {}) {
    const sessionId = input.sessionId ?? randomUUID();
    const startAt = new Date(input.startAt ?? "2042-01-02T00:00:00Z");
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    await context.pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
        total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, status,
        room_token, holding_account_id)
       values ($1,$2,'Personal booking fixture','West','Tennis',$3,$4,2000,4,2,500,$5,$6,$7,$8)`,
      [sessionId, input.bookerId ?? otherBookerId, startAt, endAt,
        input.visibility ?? "PRIVATE", input.status ?? "OPEN", randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
    );
    return sessionId;
  }

  async function participate(sessionId: string, userId: string, status: ParticipationStatus = "COMMITTED", replacementInviteeId?: string) {
    await context.pool.query(
      `insert into participations (participation_id, session_id, user_id, status, attendance,
        committed_at, withdrawn_at, waitlisted_at, replacement_mode, replacement_invitee_id)
       values ($1,$2,$3,$4,'UNVERIFIED',$5,$6,$7,$8,$9)`,
      [randomUUID(), sessionId, userId, status,
        status === "COMMITTED" || status === "WITHDRAWN" ? now : null,
        status === "WITHDRAWN" ? now : null,
        status === "WAITLISTED" || status === "LEFT_WAITLIST" ? now : null,
        replacementInviteeId ? "DIRECT_INVITE" : null, replacementInviteeId ?? null],
    );
  }

  function list(userId: string) {
    return new PostgresTransactor(context.pool).transaction((sql) =>
      new ListUpcomingBookings({
        reader: new PostgresUpcomingBookingsReader(sql),
        clock: { now: () => now },
      }).list(userId),
    );
  }

  test("includes owned and committed public/private sessions but excludes unrelated sessions", async () => {
    const { userId } = await context.identity(false);
    const expected: string[] = [];
    for (const visibility of ["PUBLIC", "PRIVATE"] as const) {
      expected.push(await insertSession({ bookerId: userId, visibility }));
      const joined = await insertSession({ visibility });
      await participate(joined, userId);
      expected.push(joined);
      const unrelated = await insertSession({ visibility });
      await participate(unrelated, otherBookerId);
    }

    expect((await list(userId)).map((booking) => booking.sessionId)).toEqual(expected.sort());
  });

  test("excludes waitlists, withdrawn or removed seats, and replacement invitations", async () => {
    const { userId } = await context.identity(false);
    for (const status of ["WAITLISTED", "LEFT_WAITLIST", "WITHDRAWN", "REMOVED", "CANCELLED"] as const) {
      await participate(await insertSession(), userId, status);
    }
    // An invitation reserves a place for this user but does not confirm enrollment.
    await participate(await insertSession(), otherBookerId, "WITHDRAWN", userId);

    expect(await list(userId)).toEqual([]);
  });

  test("excludes closed and already-started sessions for both owners and participants", async () => {
    const { userId } = await context.identity(false);
    for (const ownership of ["owned", "joined"] as const) {
      const bookerId = ownership === "owned" ? userId : otherBookerId;
      for (const status of ["CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"] as const) {
        const sessionId = await insertSession({ bookerId, status });
        if (ownership === "joined") await participate(sessionId, userId);
      }
      for (const startAt of ["2041-12-31T23:59:59.999Z", now.toISOString()]) {
        const sessionId = await insertSession({ bookerId, startAt });
        if (ownership === "joined") await participate(sessionId, userId);
      }
    }
    const upcoming = await insertSession({ bookerId: userId, startAt: "2042-01-01T00:00:00.001Z" });

    expect((await list(userId)).map((booking) => booking.sessionId)).toEqual([upcoming]);
  });

  test("deduplicates an owner who also participates and returns only the safe summary", async () => {
    const { userId } = await context.identity(false);
    const sessionId = await insertSession({ bookerId: userId });
    await participate(sessionId, userId);

    expect(await list(userId)).toEqual([{
      sessionId, venueName: "Personal booking fixture", sport: "Tennis", region: "West",
      startAt: new Date("2042-01-02T00:00:00Z"), endAt: new Date("2042-01-02T01:00:00Z"),
    }]);
  });

  test("bounds the dashboard to the earliest twenty results with stable session ID tie ordering", async () => {
    const { userId } = await context.identity(false);
    const tiedIds = Array.from({ length: 22 }, () => randomUUID()).sort();
    for (const sessionId of [...tiedIds].reverse()) {
      await insertSession({ sessionId, bookerId: userId });
    }
    const first = await insertSession({ bookerId: userId, startAt: "2042-01-01T23:59:59Z" });

    expect((await list(userId)).map((booking) => booking.sessionId)).toEqual([first, ...tiedIds.slice(0, 19)]);
  });
});
