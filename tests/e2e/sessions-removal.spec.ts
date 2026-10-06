import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { cancellationFixture, type CancellationIdentity } from "../support/cancellation-fixtures";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function login(page: Page, identity: CancellationIdentity, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
}

async function fixture(context: SessionTestContext) {
  const f = await cancellationFixture(context, 2);
  for (const [index, participant] of f.participants.entries())
    await context.pool.query("update profiles set display_name=$2 where user_id=$1", [participant.userId, `Player ${index + 1}`]);
  return { ...f, path: `/sessions/${f.sessionId}/participants` };
}

function participant(page: Page, name = "Player 1") {
  return page.getByRole("list", { name: "Participants", exact: true }).getByRole("listitem").filter({ hasText: name });
}

function mutationResponse(page: Page) {
  return page.waitForResponse((response) => response.request().method() === "POST"
    && Boolean(response.request().headers()["next-action"])
    && (response.request().postData() ?? "").includes("previewVersion"));
}

test("UC2-03b host removes a participant with a full refund, retained history, and keyboard-safe mobile UI", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const f = await fixture(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, f.booker, "/sessions");
    await page.getByRole("listitem").filter({ hasText: f.venueName }).getByRole("link", { name: "Manage participants" }).click();
    await expect(page).toHaveURL(new RegExp(`${f.path}$`));
    await expect(page.getByRole("heading", { name: "Manage participants", exact: true })).toBeVisible();
    await expect(page.getByText("0 slots available", { exact: true })).toBeVisible();
    const trigger = participant(page).getByRole("button", { name: "Remove Player 1", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("5.00");
    await expect(dialog).toContainText("rejoin");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Confirm removal" })).toBeEnabled();
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("participant-removal-mobile.png"), fullPage: true, animations: "disabled" });
    const response = mutationResponse(page);
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Player 1 removed" })).toContainText("5.00");
    await expect(participant(page)).toContainText("Removed");
    await expect(participant(page).getByRole("button")).toHaveCount(0);
    await expect(page.getByText("1 slot available", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manage participants", exact: true })).toBeFocused();
    expect((await context.pool.query("select available_cents from wallet_balances where wallet_id=$1", [f.participants[0]!.walletId])).rows[0].available_cents).toBe("500");
    expect((await context.pool.query("select status from sessions where session_id=$1", [f.sessionId])).rows[0].status).toBe("OPEN");
    await page.screenshot({ path: testInfo.outputPath("participant-removed-mobile.png"), fullPage: true, animations: "disabled" });
  } finally { await context.pool.end(); }
});

test("lost committed removal response survives reload and retries the original key", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const f = await fixture(context);
    await login(page, f.booker, f.path);
    await participant(page).getByRole("button", { name: "Remove Player 1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("5.00");
    let intercepted = false;
    await page.route(`**${f.path}`, async (route) => {
      const request = route.request();
      if (!intercepted && request.method() === "POST" && request.headers()["next-action"] && (request.postData() ?? "").includes("previewVersion")) {
        intercepted = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    await expect(dialog.getByRole("button", { name: "Retry removal" })).toBeEnabled();
    const storageKey = `participant-removal:${f.booker.userId}:${f.sessionId}`;
    const saved = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
    expect(saved).not.toBeNull();
    expect((await context.pool.query("select status from participations where participation_id=$1", [f.participants[0]!.participationId])).rows[0].status).toBe("REMOVED");
    await page.unroute(`**${f.path}`);
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText("Check removal result");
    const replay = mutationResponse(page);
    await page.getByRole("dialog").getByRole("button", { name: "Retry removal" }).click();
    expect((await replay).request().postData()).toContain(JSON.parse(saved!).idempotencyKey);
    await expect(page.getByRole("status").filter({ hasText: "Player 1 removed" })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [f.sessionId])).rows[0].count).toBe(1);
  } finally { await context.pool.end(); }
});

test("a changed target requires a fresh preview and another confirmation", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const f = await fixture(context);
    await login(page, f.booker, f.path);
    await participant(page).getByRole("button", { name: "Remove Player 1", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("5.00");
    await context.pool.query("update participations set committed_at=committed_at + interval '1 second' where participation_id=$1", [f.participants[0]!.participationId]);
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    await expect(dialog.getByRole("button", { name: "Confirm removal" })).toBeEnabled();
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [f.sessionId])).rows[0].count).toBe(0);
    await dialog.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Player 1 removed" })).toBeVisible();
  } finally { await context.pool.end(); }
});

test("participant identities are not rendered for another host", async ({ page }) => {
  const context = sessionTestContext();
  try {
    const f = await fixture(context);
    const other = await context.identity(false);
    await login(page, other, f.path);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Only the booker");
    await expect(page.getByText("Player 1", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Player 2", { exact: true })).toHaveCount(0);
  } finally { await context.pool.end(); }
});

test("bearer participant list, preview and removal enforce authorization and durable replay", async ({ request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const f = await fixture(context);
    const other = await context.identity(false);
    const listUrl = `/api/sessions/${f.sessionId}/participants`;
    const targetUrl = `${listUrl}/${f.participants[0]!.participationId}`;
    const headers = { Authorization: `Bearer ${f.booker.token}` };
    expect((await request.get(listUrl)).status()).toBe(401);
    const forbidden = await request.get(listUrl, { headers: { Authorization: `Bearer ${other.token}` } });
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.text()).not.toContain("Player 1");
    const listing = await request.get(listUrl, { headers });
    expect(listing.status()).toBe(200);
    expect(listing.headers()["cache-control"]).toBe("no-store");
    const listed = await listing.json();
    expect(listed.participants).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain(f.participants[0]!.walletId);
    const quoted = await request.get(`${targetUrl}/removal-preview`, { headers });
    expect(quoted.status()).toBe(200);
    const quote = await quoted.json();
    const data = { idempotencyKey: randomUUID(), previewVersion: quote.previewVersion };
    expect((await request.post(`${targetUrl}/remove`, { headers, data: {} })).status()).toBe(400);
    const first = await request.post(`${targetUrl}/remove`, { headers, data });
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ status: "REMOVED", refundCents: 500 });
    expect((await request.post(`${targetUrl}/remove`, { headers, data })).status()).toBe(200);
    expect((await request.post(`${listUrl}/${f.participants[1]!.participationId}/remove`, { headers, data })).status()).toBe(409);
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [f.booker.userId]);
    expect((await request.post(`${targetUrl}/remove`, { headers, data })).status()).toBe(403);
  } finally { await context.pool.end(); }
});
