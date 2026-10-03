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

test("public discovery filters real stored sessions and protects private details for every viewer", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const booker = await context.identity();
    const viewer = await context.identity(false); // Reading listings does not require payout setup.
    async function createSession(startAt: string, config: { visibility?: string; sport?: string; region?: string; venueName?: string } = {}) {
      const response = await request.post("/api/sessions", {
        headers: { Authorization: `Bearer ${booker.token}` },
        data: {
          idempotencyKey: randomUUID(),
          booking: {
            venueName: config.venueName ?? "Discovery API fixture", region: config.region ?? "West", sport: config.sport ?? "Badminton",
            startAt, endAt: new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString(), totalCostCents: 1001,
          },
          config: { totalSlots: 3, visibility: config.visibility ?? "PUBLIC" },
        },
      });
      expect(response.status()).toBe(201);
      return response.json();
    }
    const first = await createSession("2041-07-01T16:00:00Z"); // July 2 at midnight in Singapore.
    const later = await createSession("2041-07-02T10:00:00Z", { venueName: "100%_O'Brien\\Court" });
    await createSession("2041-07-02T10:00:00Z", { region: "East" });
    await createSession("2041-07-02T10:00:00Z", { sport: "Tennis" });
    const privateSession = await createSession("2041-07-02T10:00:00Z", { visibility: "PRIVATE" });
    await createSession("2041-07-02T16:00:00Z"); // Next Singapore day.
    const cancelled = await createSession("2041-07-02T10:00:00Z");
    await context.pool.query("update sessions set status = 'CANCELLED' where session_id = $1", [cancelled.sessionId]);

    const headers = { Authorization: `Bearer ${viewer.token}` };
    const params = { date: "2041-07-02", sport: "Badminton", region: "West" };
    const response = await request.get("/api/sessions", { params });
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
      params: { date: "2041-07-02", sport: "Badminton", region: "West", timeFrom: "18:00", timeTo: "19:00" },
    });
    expect((await narrowed.json()).items.map((item: DiscoveryItem) => item.sessionId)).toEqual([later.sessionId]);
    const empty = await request.get("/api/sessions", { params: { date: "2041-07-02", sport: "Volleyball" } });
    expect(await empty.json()).toEqual({ items: [], nextCursor: null });
    const searched = await request.get("/api/sessions", {
      params: { q: "  o'BRIEN\\court  ", date: "2041-07-02", sport: "Badminton", region: "West" },
    });
    expect(searched.status()).toBe(200);
    expect((await searched.json()).items.map((item: DiscoveryItem) => item.sessionId)).toEqual([later.sessionId]);
    const literal = await request.get("/api/sessions", { params: { q: "100%_", date: "2041-07-02" } });
    expect((await literal.json()).items.map((item: DiscoveryItem) => item.sessionId)).toEqual([later.sessionId]);
    const sportSearch = await request.get("/api/sessions", {
      params: { q: "badmin", date: "2041-07-02", sport: "Badminton", region: "West" },
    });
    expect((await sportSearch.json()).items.map((item: DiscoveryItem) => item.sessionId)).toEqual([first.sessionId, later.sessionId]);

    const authenticated = await request.get("/api/sessions", { headers, params });
    expect(authenticated.status()).toBe(200);
    expect(await authenticated.json()).toEqual(body);
    expect((await request.get("/api/sessions?cursor=invalid")).status()).toBe(400);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [viewer.userId]);
    const invalidForInactive = await request.get("/api/sessions?cursor=invalid", { headers });
    expect(invalidForInactive.status()).toBe(400);
    expect(await invalidForInactive.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    const inactive = await request.get("/api/sessions", { headers, params });
    expect(inactive.status()).toBe(200);
    expect(await inactive.json()).toEqual(body);
  } finally {
    await context.pool.end();
  }
});

test("public discovery works without a participant profile, wallet, or confirmed email", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const owner = await context.identity(false);
    const sessionId = randomUUID();
    const venueName = `Public hydration fixture ${randomUUID()}`;
    await context.pool.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
       total_cost_cents, total_slots, booking_share_cents, visibility, room_token, holding_account_id)
       values ($1,$2,$3,'West','Badminton','2041-07-12T10:00:00Z','2041-07-12T12:00:00Z',1001,3,333,'PUBLIC',$4,$5)`,
      [sessionId, owner.userId, venueName, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
    );
    const params = { q: venueName };
    const anonymous = await request.get("/api/sessions", { params });
    expect(anonymous.status()).toBe(200);
    const body: DiscoveryPage = await anonymous.json();
    expect(body.items.map((item) => item.sessionId)).toEqual([sessionId]);

    const missing = await context.identity(false);
    await context.pool.query("delete from profiles where user_id = $1", [missing.userId]);
    const missingResponse = await request.get("/api/sessions", {
      headers: { Authorization: `Bearer ${missing.token}` }, params,
    });
    expect(missingResponse.status()).toBe(200);
    expect(await missingResponse.json()).toEqual(body);

    const incomplete = await context.identity(false);
    await context.pool.query("delete from wallet_balances where wallet_id = $1", [incomplete.walletId]);
    await context.pool.query("delete from wallets where wallet_id = $1", [incomplete.walletId]);
    const headers = { Authorization: `Bearer ${incomplete.token}` };
    const invalid = await request.get("/api/sessions?cursor=invalid", { headers });
    expect(invalid.status()).toBe(400);
    const incompleteResponse = await request.get("/api/sessions", { headers, params });
    expect(incompleteResponse.status()).toBe(200);
    expect(await incompleteResponse.json()).toEqual(body);

    await context.pool.query("update auth.users set email = null, email_confirmed_at = null where id = $1", [incomplete.userId]);
    const unconfirmed = await request.get("/api/sessions", { headers, params });
    expect(unconfirmed.status()).toBe(200);
    expect(await unconfirmed.json()).toEqual(body);
  } finally {
    await context.pool.end();
  }
});

test("rejects invalid discovery queries and pages tied start times without repeats", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const viewer = await context.identity(false);
    for (const query of [
      "q=tennis&q=badminton", `q=${"a".repeat(101)}`,
      "sport=Badminton&sport=Tennis", "region=West&region=", "date=2041-02-29", "timeFrom=18%3A00",
      "date=2041-07-03&timeFrom=20%3A00&timeTo=18%3A00", "cursor=invalid",
    ]) {
      const response = await request.get(`/api/sessions?${query}`);
      expect(response.status()).toBe(400);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid session discovery query" } });
    }
    const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
    for (const id of [...ids].reverse()) {
      await context.pool.query(
        `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
         total_cost_cents, total_slots, booking_share_cents, visibility, room_token, holding_account_id)
         values ($1,$2,'Paged discovery venue','West','Badminton','2041-07-10T10:00:00Z','2041-07-10T12:00:00Z',1001,3,333,'PUBLIC',$3,$4)`,
        [id, viewer.userId, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
      );
    }
    // Keep this window separate from the preceding test's next-day boundary fixture.
    const firstResponse = await request.get("/api/sessions", { params: { q: "PAGED", date: "2041-07-10", sport: "", unknown: "ignored" } });
    expect(firstResponse.status()).toBe(200);
    const first: DiscoveryPage = await firstResponse.json();
    expect(first.items.map((item) => item.sessionId)).toEqual(ids.slice(0, 20));
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("Missing next page cursor");
    const secondResponse = await request.get("/api/sessions", { params: { q: "PAGED", date: "2041-07-10", cursor: first.nextCursor } });
    expect(secondResponse.status()).toBe(200);
    const second: DiscoveryPage = await secondResponse.json();
    expect(second.items.map((item) => item.sessionId)).toEqual(ids.slice(20));
    expect(second.nextCursor).toBeNull();
  } finally {
    await context.pool.end();
  }
});
