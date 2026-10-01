import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext } from "../support/session-test-context";

interface DiscoveryItem {
  sessionId: string;
  venueName: string;
  region: string;
  sport: string;
  startAt: string;
  endAt: string;
  totalSlots: number;
  bookingShareCents: number;
}
interface DiscoveryPage { items: DiscoveryItem[]; nextCursor: string | null }

test("authenticated discovery filters real stored sessions and protects private details", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const booker = await context.identity();
    const viewer = await context.identity(false); // Reading listings does not require payout setup.
    async function createSession(startAt: string, config: { visibility?: string; sport?: string; region?: string } = {}) {
      const response = await request.post("/api/sessions", {
        headers: { Authorization: `Bearer ${booker.token}` },
        data: {
          idempotencyKey: randomUUID(),
          booking: {
            venueName: "Discovery API fixture", region: config.region ?? "West", sport: config.sport ?? "Badminton",
            startAt, endAt: new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString(), totalCostCents: 1001,
          },
          config: { totalSlots: 3, minimumHeadcount: 2, visibility: config.visibility ?? "PUBLIC" },
        },
      });
      expect(response.status()).toBe(201);
      return response.json();
    }
    const first = await createSession("2041-07-01T16:00:00Z"); // July 2 at midnight in Singapore.
    const later = await createSession("2041-07-02T10:00:00Z");
    await createSession("2041-07-02T10:00:00Z", { region: "East" });
    await createSession("2041-07-02T10:00:00Z", { sport: "Tennis" });
    const privateSession = await createSession("2041-07-02T10:00:00Z", { visibility: "PRIVATE" });
    await createSession("2041-07-02T16:00:00Z"); // Next Singapore day.
    const cancelled = await createSession("2041-07-02T10:00:00Z");
    await context.pool.query("update sessions set status = 'CANCELLED' where session_id = $1", [cancelled.sessionId]);

    const headers = { Authorization: `Bearer ${viewer.token}` };
    const response = await request.get("/api/sessions", {
      headers, params: { date: "2041-07-02", sport: "Badminton", region: "West" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body: DiscoveryPage = await response.json();
    expect(body.items.map((item) => item.sessionId)).toEqual([first.sessionId, later.sessionId]);
    expect(body.nextCursor).toBeNull();
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "bookingShareCents", "endAt", "region", "sessionId", "sport", "startAt", "totalSlots", "venueName",
      ]);
      expect(item.bookingShareCents).toBe(333);
    }
    expect(JSON.stringify(body)).not.toContain(privateSession.sessionId);
    expect(JSON.stringify(body)).not.toContain(first.roomToken);
    const narrowed = await request.get("/api/sessions", {
      headers, params: { date: "2041-07-02", sport: "Badminton", region: "West", timeFrom: "18:00", timeTo: "19:00" },
    });
    expect((await narrowed.json()).items.map((item: DiscoveryItem) => item.sessionId)).toEqual([later.sessionId]);
    const empty = await request.get("/api/sessions", { headers, params: { date: "2041-07-02", sport: "Volleyball" } });
    expect(await empty.json()).toEqual({ items: [], nextCursor: null });

    const unauthenticated = await request.get("/api/sessions");
    expect(unauthenticated.status()).toBe(401);
    expect(unauthenticated.headers()["cache-control"]).toBe("no-store");
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [viewer.userId]);
    const inactive = await request.get("/api/sessions", { headers });
    expect(inactive.status()).toBe(403);
    expect(await inactive.json()).toMatchObject({ error: { code: "INACTIVE_ACCOUNT" } });
  } finally {
    await context.pool.end();
  }
});

test("rejects invalid discovery queries and pages tied start times without repeats", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const viewer = await context.identity(false);
    const headers = { Authorization: `Bearer ${viewer.token}` };
    for (const query of [
      "sport=Badminton&sport=Tennis", "region=West&region=", "date=2041-02-29", "timeFrom=18%3A00",
      "date=2041-07-03&timeFrom=20%3A00&timeTo=18%3A00", "cursor=invalid",
    ]) {
      const response = await request.get(`/api/sessions?${query}`, { headers });
      expect(response.status()).toBe(400);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    }
    const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
    for (const id of [...ids].reverse()) {
      await context.pool.query(
        `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
         total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, room_token, holding_account_id)
         values ($1,$2,'Paged discovery venue','West','Badminton','2041-07-10T10:00:00Z','2041-07-10T12:00:00Z',1001,3,2,333,'PUBLIC',$3,$4)`,
        [id, viewer.userId, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
      );
    }
    // Keep this window separate from the preceding test's next-day boundary fixture.
    const firstResponse = await request.get("/api/sessions", { headers, params: { date: "2041-07-10", sport: "", unknown: "ignored" } });
    expect(firstResponse.status()).toBe(200);
    const first: DiscoveryPage = await firstResponse.json();
    expect(first.items.map((item) => item.sessionId)).toEqual(ids.slice(0, 20));
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("Missing next page cursor");
    const secondResponse = await request.get("/api/sessions", { headers, params: { date: "2041-07-10", cursor: first.nextCursor } });
    expect(secondResponse.status()).toBe(200);
    const second: DiscoveryPage = await secondResponse.json();
    expect(second.items.map((item) => item.sessionId)).toEqual(ids.slice(20));
    expect(second.nextCursor).toBeNull();
  } finally {
    await context.pool.end();
  }
});
