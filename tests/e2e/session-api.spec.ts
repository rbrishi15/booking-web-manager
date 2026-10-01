import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createTestIdentity,
  localSupabaseTestContext,
  prepareEligibleBooker,
  type LocalSupabaseTestContext,
} from "../support/local-supabase";

test.describe("UC2-02 Create Session over HTTP", () => {
  let context: LocalSupabaseTestContext;

  test.beforeAll(() => {
    context = localSupabaseTestContext();
  });

  test.afterAll(async () => {
    await context?.pool.end();
  });

  test("creates a private session for the verified booker with a 333-cent share", async ({
    request,
  }) => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const token = await context.signIn(booker.email, booker.password);
    const body = creationRequest();
    const forgedBookerId = randomUUID();

    // Act
    const response = await request.post("/api/sessions", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        ...body,
        bookerId: forgedBookerId,
        bookingShareCents: 1,
        roomToken: "forged-room",
        config: { ...body.config, bookingShareCents: 1 },
      },
    });
    const result = await response.json();

    // Assert
    expect(response.status()).toBe(201);
    expect(result).toEqual({
      sessionId: expect.any(String),
      roomToken: expect.any(String),
      bookingShareCents: 333,
    });
    expect(result.roomToken).not.toBe("forged-room");
    const stored = await context.pool.query(
      "select booker_id, total_slots, minimum_headcount, visibility, booking_share_cents from public.sessions where session_id = $1",
      [result.sessionId],
    );
    expect(stored.rows).toEqual([
      {
        booker_id: booker.userId,
        total_slots: 3,
        minimum_headcount: 2,
        visibility: "PRIVATE",
        booking_share_cents: "333",
      },
    ]);
  });

  test("rejects missing and invalid bearer authentication", async ({
    request,
  }) => {
    // Arrange
    const body = creationRequest();

    // Act
    const missing = await request.post("/api/sessions", { data: body });
    const invalid = await request.post("/api/sessions", {
      headers: { Authorization: "Bearer not-a-valid-access-token" },
      data: body,
    });

    // Assert
    expect(missing.status()).toBe(401);
    expect(invalid.status()).toBe(401);
    expect(await missing.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await invalid.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  test("rejects a real authenticated account without completed payout setup", async ({
    request,
  }) => {
    // Arrange
    const booker = await createTestIdentity(context);
    const token = await context.signIn(booker.email, booker.password);

    // Act
    const response = await request.post("/api/sessions", {
      headers: { Authorization: `Bearer ${token}` },
      data: creationRequest(),
    });

    // Assert
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYOUT_ACCOUNT_NOT_READY" },
    });
    const stored = await context.pool.query(
      "select session_id from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(stored.rows).toEqual([]);
  });

  test("replays for an active account after payout and booking eligibility change", async ({
    request,
  }) => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const token = await context.signIn(booker.email, booker.password);
    const body = creationRequest();
    const headers = { Authorization: `Bearer ${token}` };
    const first = await request.post("/api/sessions", { headers, data: body });
    const original = await first.json();
    await context.pool.query(
      "update public.payout_accounts set setup_status = 'FAILED', bank_account_reference = null where user_id = $1",
      [booker.userId],
    );

    // Act
    const retry = await request.post("/api/sessions", {
      headers,
      data: {
        ...body,
        booking: {
          ...body.booking,
          startAt: "2020-01-01T10:00:00Z",
          endAt: "2020-01-01T12:00:00Z",
        },
        config: { totalSlots: 2, minimumHeadcount: 2 },
      },
    });

    // Assert
    expect(first.status()).toBe(201);
    expect(retry.status()).toBe(201);
    expect(await retry.json()).toEqual(original);
    const stored = await context.pool.query(
      "select session_id, total_slots from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(stored.rows).toEqual([
      { session_id: original.sessionId, total_slots: 3 },
    ]);
  });

  test("denies a successful submission replay after the authenticated profile becomes inactive", async ({
    request,
  }) => {
    // Arrange
    const booker = await prepareEligibleBooker(context);
    const token = await context.signIn(booker.email, booker.password);
    const body = creationRequest();
    const headers = { Authorization: `Bearer ${token}` };
    const first = await request.post("/api/sessions", { headers, data: body });
    expect(first.status()).toBe(201);
    const original = await first.json();
    await context.pool.query(
      "update public.profiles set account_status = 'INACTIVE' where user_id = $1",
      [booker.userId],
    );

    // Act
    const retry = await request.post("/api/sessions", { headers, data: body });

    // Assert
    expect(retry.status()).toBe(403);
    expect(await retry.json()).toEqual({
      error: {
        code: "INACTIVE_ACCOUNT",
        message: "An inactive account cannot use the session API",
      },
    });
    const stored = await context.pool.query(
      "select session_id from public.sessions where booker_id = $1",
      [booker.userId],
    );
    expect(stored.rows).toEqual([{ session_id: original.sessionId }]);
  });
});

function creationRequest() {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  return {
    idempotencyKey: randomUUID(),
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: startsAt.toISOString(),
      endAt: endsAt.toISOString(),
      totalCostCents: 1001,
    },
    config: { totalSlots: 3, minimumHeadcount: 2 },
  };
}
