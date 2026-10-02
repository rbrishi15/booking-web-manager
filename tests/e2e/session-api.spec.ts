import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { sessionTestContext } from "../support/session-test-context";

const body = () => ({
  idempotencyKey: randomUUID(),
  booking: {
    venueName: "Jurong East Sports Hall",
    region: "West",
    sport: "Badminton",
    startAt: "2030-01-02T10:00:00Z",
    endAt: "2030-01-02T12:00:00Z",
    totalCostCents: 1001,
  },
  config: { totalSlots: 3 },
});

test("authenticated creation replays atomically and refuses replay after deactivation", async ({
  request,
}) => {
  const context = sessionTestContext();
  try {
    const booker = await context.identity();
    const submission = body();
    const headers = { Authorization: `Bearer ${booker.token}` };
    const created = await request.post("/api/sessions", {
      headers,
      data: submission,
    });
    expect(created.status()).toBe(201);
    const result = await created.json();
    expect(result).toMatchObject({ bookingShareCents: 333 });
    const replays = await Promise.all(
      Array.from({ length: 4 }, () =>
        request.post("/api/sessions", {
          headers,
          data: {
            ...submission,
            booking: { ...submission.booking, totalCostCents: 9999 },
          },
        }),
      ),
    );
    for (const response of replays) {
      expect(response.status()).toBe(201);
      expect(await response.json()).toEqual(result);
    }
    expect(
      (
        await context.pool.query(
          "select count(*)::int as count from sessions where booker_id = $1",
          [booker.userId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await context.pool.query(
          "select count(*)::int as count from ledger_entries where wallet_id = $1 or session_id = $2",
          [booker.walletId, result.sessionId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await context.pool.query(
          "select count(*)::int as count from payout_payables where session_id = $1",
          [result.sessionId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    await context.pool.query(
      "update profiles set account_status = 'INACTIVE' where user_id = $1",
      [booker.userId],
    );
    const denied = await request.post("/api/sessions", {
      headers,
      data: submission,
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "INACTIVE_ACCOUNT" },
    });
  } finally {
    await context.pool.end();
  }
});

test("missing, malformed and rejected bearer credentials return JSON 401", async ({
  request,
}) => {
  for (const authorization of [
    undefined,
    "Basic invalid",
    "Bearer invalid-token",
  ]) {
    const response = await request.post("/api/sessions", {
      headers: authorization ? { Authorization: authorization } : {},
      data: body(),
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  }
});

test("payout eligibility and invalid input retain distinct responses", async ({
  request,
}) => {
  const context = sessionTestContext();
  try {
    const booker = await context.identity(false);
    const headers = { Authorization: `Bearer ${booker.token}` };
    expect(
      (await request.post("/api/sessions", { headers, data: body() })).status(),
    ).toBe(409);
    const eligibleIdentity = await context.identity();
    expect(
      (
        await request.post("/api/sessions", {
          headers,
          data: { ...body(), bookerId: eligibleIdentity.userId },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.post("/api/sessions", {
          headers,
          data: {
            ...body(),
            config: { totalSlots: "three" },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (await request.post("/api/sessions", { headers, data: "{" })).status(),
    ).toBe(400);
  } finally {
    await context.pool.end();
  }
});

test("a verified identity whose profile is missing returns 404", async ({
  request,
}) => {
  const context = sessionTestContext();
  try {
    const identity = await context.identity(false);
    await context.pool.query("delete from profiles where user_id = $1", [
      identity.userId,
    ]);
    const response = await request.post("/api/sessions", {
      headers: { Authorization: `Bearer ${identity.token}` },
      data: body(),
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  } finally {
    await context.pool.end();
  }
});
