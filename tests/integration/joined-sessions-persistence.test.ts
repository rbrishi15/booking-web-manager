import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import { PostgresJoinedSessionsReader } from "@/lib/sessions/postgres-joined-sessions-reader";
import { ListJoinedSessions } from "@/use-cases/sessions/ListJoinedSessions";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const now = new Date("2042-01-01T00:00:00Z");
type ParticipationStatus = "COMMITTED" | "WAITLISTED" | "LEFT_WAITLIST" | "WITHDRAWN" | "REMOVED" | "CANCELLED";

describe("PostgreSQL UC2-05 joined sessions", () => {
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
       values ($1,$2,'Joined session fixture','West','Tennis',$3,$4,2000,4,2,500,$5,$6,$7,$8)`,
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
      new ListJoinedSessions({
        reader: new PostgresJoinedSessionsReader(sql),
        clock: { now: () => now },
      }).forParticipant(userId),
    );
  }

  test("lists committed and waitlisted places in start order with the share in cents", async () => {
    const { userId } = await context.identity(false);
    const later = await insertSession({ startAt: "2042-01-03T00:00:00Z" });
    await participate(later, userId, "WAITLISTED");
    const sooner = await insertSession({ visibility: "PUBLIC" });
    await participate(sooner, userId, "COMMITTED");
    await participate(await insertSession(), otherBookerId, "COMMITTED");

    expect(await list(userId)).toEqual([
      { sessionId: sooner, venueName: "Joined session fixture", sport: "Tennis", region: "West",
        startAt: new Date("2042-01-02T00:00:00Z"), endAt: new Date("2042-01-02T01:00:00Z"), status: "COMMITTED", bookingShareCents: 500 },
      { sessionId: later, venueName: "Joined session fixture", sport: "Tennis", region: "West",
        startAt: new Date("2042-01-03T00:00:00Z"), endAt: new Date("2042-01-03T01:00:00Z"), status: "WAITLISTED", bookingShareCents: 500 },
    ]);
  });

  test("excludes places already left, withdrawn, removed or cancelled, invitations, and sessions the user only hosts", async () => {
    const { userId } = await context.identity(false);
    for (const status of ["LEFT_WAITLIST", "WITHDRAWN", "REMOVED", "CANCELLED"] as const) {
      await participate(await insertSession(), userId, status);
    }
    await participate(await insertSession(), otherBookerId, "WITHDRAWN", userId);
    await insertSession({ bookerId: userId });

    expect(await list(userId)).toEqual([]);
  });

  test("excludes closed and already-started sessions", async () => {
    const { userId } = await context.identity(false);
    for (const status of ["CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"] as const) {
      await participate(await insertSession({ status }), userId);
    }
    for (const startAt of ["2041-12-31T23:59:59.999Z", now.toISOString()]) {
      await participate(await insertSession({ startAt }), userId);
    }
    const upcoming = await insertSession({ startAt: "2042-01-01T00:00:00.001Z" });
    await participate(upcoming, userId);

    expect((await list(userId)).map((session) => session.sessionId)).toEqual([upcoming]);
  });

  test("rejects an inactive account before listing", async () => {
    const { userId } = await context.identity(false);
    await participate(await insertSession(), userId);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [userId]);

    await expect(list(userId)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
  });
});
