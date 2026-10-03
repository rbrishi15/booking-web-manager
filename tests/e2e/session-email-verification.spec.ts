import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

type Identity = Awaited<ReturnType<SessionTestContext["identity"]>>;

async function login(page: Page, identity: Identity) {
  await page.goto("/login?next=%2Fsessions");
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole("heading", { name: "Sessions you host", exact: true })).toBeVisible();
}

function submission(venueName: string) {
  return {
    idempotencyKey: randomUUID(),
    booking: { venueName, region: "West", sport: "Badminton", startAt: "2045-04-02T10:00:00Z", endAt: "2045-04-02T12:00:00Z", totalCostCents: 1001 },
    config: { totalSlots: 3, visibility: "PUBLIC" },
  };
}

test("an existing unconfirmed session browses, refuses new and replayed creation, and recovers after confirmation", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const identity = await context.identity();
    const venue = `Email-${randomUUID().slice(0, 8)}`;
    const body = submission(venue);
    const headers = { Authorization: `Bearer ${identity.token}` };
    await login(page, identity);
    const created = await request.post("/api/sessions", { headers, data: body });
    expect(created.status()).toBe(201);
    const receipt = await created.json();

    // Model a usable preexisting login whose email is no longer confirmed.
    // This disposable stack does not send emails; confirmation is simulated below.
    await context.pool.query("update auth.users set email_confirmed_at=null where id=$1", [identity.userId]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/discover?q=${venue}`);
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: venue })).toBeVisible();
    await expect(page.getByText("Verify your email to create or join sessions.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Verify email", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("unconfirmed-discovery-mobile.png"), fullPage: true });

    await page.goto("/sessions");
    await expect(page.getByRole("link", { name: "Create a session", exact: true })).toHaveCount(0);
    await page.goto("/sessions/create");
    await expect(page).toHaveURL(/\/profile\/email$/);
    await expect(page.getByRole("button", { name: "Resend confirmation email", exact: true })).toBeVisible();

    const browserOrigin = new URL(page.url()).origin;
    await page.goto("/auth/callback?code=expired-email-code");
    await expect(page).toHaveURL(`${browserOrigin}/profile/email?verification=failed`);
    await expect(page.getByText("We couldn't finish that confirmation link. Check your verification status below or request a new link.", { exact: true })).toBeVisible();
    for (const data of [body, { ...body, idempotencyKey: randomUUID() }]) {
      const denied = await request.post("/api/sessions", { headers, data });
      expect(denied.status()).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "EMAIL_VERIFICATION_REQUIRED" } });
    }
    expect((await context.pool.query("select count(*)::int as count from sessions where booker_id=$1", [identity.userId])).rows).toEqual([{ count: 1 }]);

    await context.pool.query("update auth.users set email_confirmed_at=now() where id=$1", [identity.userId]);
    await page.getByRole("button", { name: "I've confirmed my email — check again", exact: true }).click();
    await expect(page.getByText("Your email is verified. You can create and join sessions.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create a session", exact: true })).toBeVisible();
    await expect(page.getByText("We couldn't finish that confirmation link.", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Verify your email to create or join sessions.", { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("confirmed-email-desktop.png"), fullPage: true });
    const replay = await request.post("/api/sessions", { headers, data: body });
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(receipt);
  } finally {
    await context.pool.end();
  }
});

test("a signed-in account with no email sees an add-email form and retains recovery after a failed callback", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  let identity: Identity | undefined;
  try {
    identity = await context.identity(false);
    await login(page, identity);
    await context.pool.query("update auth.users set email='', email_confirmed_at=null where id=$1", [identity.userId]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/discover");
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add email", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Add email", exact: true }).click();
    await expect(page.getByLabel("Add an email address", { exact: true })).toBeVisible();
    await page.getByLabel("Add an email address", { exact: true }).fill(`addition-${randomUUID()}@example.com`);
    await expect(page.getByRole("button", { name: "Send confirmation link", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Create a session", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("missing-email-mobile.png"), fullPage: true });
    const browserOrigin = new URL(page.url()).origin;
    await page.goto("/auth/callback?error=expired&error_description=private-detail");
    await expect(page).toHaveURL(`${browserOrigin}/profile/email?verification=failed`);
    await expect(page.getByLabel("Add an email address", { exact: true })).toBeVisible();
    await expect(page.getByText("private-detail", { exact: true })).toHaveCount(0);
  } finally {
    try {
      // Leave the disposable account reusable when this file is retried in the same stack.
      if (identity !== undefined) await context.pool.query("update auth.users set email=$1, email_confirmed_at=now() where id=$2", [identity.email, identity.userId]);
    } finally {
      await context.pool.end();
    }
  }
});
