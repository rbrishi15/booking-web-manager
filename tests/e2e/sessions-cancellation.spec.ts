import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { cancellationFixture, addCancellationParticipant, cancellationSql, type CancellationIdentity } from "../support/cancellation-fixtures";
import { sessionTestContext } from "../support/session-test-context";

async function login(page: Page, identity: CancellationIdentity, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname + url.search;
  }).toBe(destination);
}
function row(page: Page, venueName: string) {
  return page.getByRole("listitem").filter({ hasText: venueName });
}
function mutationResponse(page: Page, sessionId: string) {
  return page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/sessions/${sessionId}/cancel`
    && (response.request().postData() ?? "").includes("previewVersion"));
}

test("UC2-03c full session cancellation refunds wallets and disappears from open discovery within three seconds", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  const participantBrowser = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const fixture = await cancellationFixture(context, 2);
    const participantPage = await participantBrowser.newPage();
    await login(participantPage, fixture.participants[0]!, `/discover?q=${fixture.venueName}&returnTo=%2Fsessions`);
    await expect(row(participantPage, fixture.venueName)).toBeVisible();
    const search = participantPage.getByRole("searchbox");
    await search.fill("Unsubmitted cancellation draft");
    await search.focus();
    const url = participantPage.url();
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, fixture.booker, "/sessions");
    await expect(row(page, fixture.venueName).getByRole("button", { name: "Make private" })).toHaveCount(0);
    const trigger = row(page, fixture.venueName).getByRole("button", { name: "Cancel session", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("10.00");
    await expect(dialog).toContainText("2 participants will receive a refund");
    await expect(dialog).toContainText("venue booking cancellation separately");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText("10.00");
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0].status).toBe("OPEN");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("session-cancellation-mobile.png"), fullPage: true });
    const response = mutationResponse(page, fixture.sessionId);
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    expect((await response).status()).toBe(200);
    const committedAt = Date.now();
    await expect(row(participantPage, fixture.venueName)).toHaveCount(0, { timeout: Math.max(1, 3000 - (Date.now() - committedAt)) });
    expect(Date.now() - committedAt).toBeLessThanOrEqual(3000);
    await expect(search).toHaveValue("Unsubmitted cancellation draft");
    await expect(search).toBeFocused();
    expect(participantPage.url()).toBe(url);
    await expect(page.getByRole("status")).toContainText("Session cancelled");
    await expect(row(page, fixture.venueName)).toHaveCount(0);
    for (const participant of fixture.participants) {
      expect((await context.pool.query("select available_cents from wallet_balances where wallet_id=$1", [participant.walletId])).rows[0].available_cents).toBe("500");
    }
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [fixture.sessionId])).rows[0].count).toBe(2);
  } finally {
    await participantBrowser.close();
    await context.pool.end();
  }
});

test("changed roster requires a fresh preview and another confirmation", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await cancellationFixture(context);
    await login(page, fixture.booker, "/sessions");
    await row(page, fixture.venueName).getByRole("button", { name: "Cancel session" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("5.00");
    await addCancellationParticipant(cancellationSql(context), fixture.sessionId, await context.identity(false));
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(dialog).toContainText("10.00");
    await expect(dialog.getByRole("alert")).toContainText("The session changed");
    await expect(dialog.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0].status).toBe("OPEN");
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [fixture.sessionId])).rows[0].count).toBe(0);
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(page.getByRole("status")).toContainText("Session cancelled");
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [fixture.sessionId])).rows[0].count).toBe(2);
  } finally { await context.pool.end(); }
});

test("lost committed response survives reload and replays the identical financial request", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await cancellationFixture(context);
    await login(page, fixture.booker, "/sessions");
    await row(page, fixture.venueName).getByRole("button", { name: "Cancel session" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("5.00");
    let intercepted = false;
    let confirmedSubmission: unknown;
    const cancellationUrl = `**/api/sessions/${fixture.sessionId}/cancel`;
    await page.route(cancellationUrl, async (route) => {
      const incoming = route.request();
      if (!intercepted && incoming.method() === "POST" && (incoming.postData() ?? "").includes("previewVersion")) {
        intercepted = true;
        confirmedSubmission = JSON.parse(incoming.postData()!);
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(dialog.getByRole("button", { name: "Retry cancellation" })).toBeEnabled();
    await expect(dialog.getByRole("alert")).toBeVisible();
    const key = `session-cancellation:${fixture.booker.userId}`;
    const saved = await page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key);
    expect(saved).not.toBeNull();
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0].status).toBe("CANCELLED");
    await page.unroute(cancellationUrl);
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText("Retry the cancellation you already confirmed");
    const replay = mutationResponse(page, fixture.sessionId);
    await page.getByRole("dialog").getByRole("button", { name: "Retry cancellation" }).click();
    const incoming = (await replay).request().postData() ?? "";
    expect(JSON.parse(incoming)).toEqual(confirmedSubmission);
    expect(incoming).toContain(JSON.parse(saved!).idempotencyKey);
    await expect(page.getByRole("status")).toContainText("Session cancelled");
    expect(await page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key)).toBeNull();
    expect((await context.pool.query("select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [fixture.sessionId])).rows[0].count).toBe(1);
  } finally { await context.pool.end(); }
});

test("bearer endpoints enforce access, validation, replay and inactive application policy", async ({ request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await cancellationFixture(context, 0);
    const other = await context.identity(false);
    const url = `/api/sessions/${fixture.sessionId}`;
    const ownerHeaders = { Authorization: `Bearer ${fixture.booker.token}` };
    // Removing an owner's email must preserve cleanup of sessions already hosted.
    await context.pool.query("update auth.users set email=null, email_confirmed_at=null where id=$1", [fixture.booker.userId]);
    expect((await request.get(`${url}/cancellation-preview`)).status()).toBe(401);
    expect((await request.get(`${url}/cancellation-preview`, { headers: { Authorization: `Bearer ${other.token}` } })).status()).toBe(403);
    const preview = await request.get(`${url}/cancellation-preview`, { headers: ownerHeaders });
    expect(preview.status()).toBe(200);
    const quote = await preview.json();
    const submission = { idempotencyKey: randomUUID(), previewVersion: quote.previewVersion };
    expect((await request.post(`${url}/cancel`, { headers: ownerHeaders, data: {} })).status()).toBe(400);
    expect((await request.get(`/api/sessions/${randomUUID()}/cancellation-preview`, { headers: ownerHeaders })).status()).toBe(404);
    const first = await request.post(`${url}/cancel`, { headers: ownerHeaders, data: submission });
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ status: "CANCELLED", totalRefundCents: 0 });
    expect((await request.post(`${url}/cancel`, { headers: ownerHeaders, data: submission })).status()).toBe(200);
    expect((await request.post(`${url}/cancel`, { headers: ownerHeaders, data: { ...submission, idempotencyKey: randomUUID() } })).status()).toBe(409);
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [fixture.booker.userId]);
    expect((await request.post(`${url}/cancel`, { headers: ownerHeaders, data: submission })).status()).toBe(403);
  } finally { await context.pool.end(); }
});
