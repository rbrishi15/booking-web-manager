import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

type Identity = Awaited<ReturnType<SessionTestContext["identity"]>>;
type Visibility = "PRIVATE" | "PUBLIC";

/** Signs in a fixture identity through the UI and waits for the requested destination. */
async function login(page: Page, identity: Identity, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }).toBe(destination);
}

/** Inserts a two-slot session fixture with configurable visibility and start time, returning its ID. */
async function insertSession(context: SessionTestContext, bookerId: string, venue: string, input: {
  visibility?: Visibility; startAt?: string;
} = {}) {
  const sessionId = randomUUID();
  const start = new Date(input.startAt ?? "2045-04-02T10:00:00Z");
  await context.pool.query(
    `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
      total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, room_token, holding_account_id)
     values ($1,$2,$3,'West','Badminton',$4,$5,200,2,2,100,$6,$7,$8)`,
    [sessionId, bookerId, venue, start, new Date(start.getTime() + 7_200_000),
      input.visibility ?? "PRIVATE", randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
  return sessionId;
}

/** Seeds a committed participation and its matching held funds to occupy one fixture session slot. */
async function commitFixture(context: SessionTestContext, sessionId: string, participant: Identity) {
  const participationId = randomUUID();
  await context.pool.query(
    `insert into participations (participation_id, session_id, user_id, status, attendance, committed_at)
     values ($1,$2,$3,'COMMITTED','UNVERIFIED',now())`,
    [participationId, sessionId, participant.userId],
  );
  await context.pool.query(
    `insert into fund_holds (hold_id, participation_id, holding_account_id, wallet_id, amount_cents, state, created_at)
     values ($1,$2,$3,$4,100,'HELD',now())`,
    [randomUUID(), participationId, PLATFORM_HOLDING_ACCOUNT_ID, participant.walletId],
  );
}

/** Locates a hosted-session list item by its venue text. */
function row(page: Page, venue: string): Locator {
  return page.getByRole("listitem").filter({ hasText: venue });
}

/** Clicks the visibility control, checks the server-action HTTP response, and returns the observation time for latency assertions. */
async function setThroughPage(page: Page, venue: string, visibility: Visibility): Promise<number> {
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" &&
    Boolean(candidate.request().headers()["next-action"]) &&
    new URL(candidate.url()).pathname === "/sessions",
  );
  await row(page, venue).getByRole("button", {
    name: visibility === "PUBLIC" ? "Make public" : "Make private", exact: true,
  }).click();
  expect((await response).status()).toBe(200);
  return Date.now();
}

/** Sends a visibility PATCH using the fixture identity's bearer token. */
async function patch(request: APIRequestContext, identity: Identity, sessionId: string, visibility: Visibility) {
  return request.patch(`/api/sessions/${sessionId}/visibility`, {
    headers: { Authorization: `Bearer ${identity.token}` }, data: { visibility },
  });
}

test("UC2-03a owner controls update an open discovery page within three seconds and preserve drafts", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  const participantBrowser = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const participantPage = await participantBrowser.newPage();
  try {
    const booker = await context.identity(false);
    const participant = await context.identity(false);
    const venue = `Visibility-${randomUUID().slice(0, 8)}`;
    await insertSession(context, booker.userId, venue);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, booker, "/sessions");
    await expect(page.getByRole("heading", { name: "Sessions you host", exact: true })).toBeVisible();
    const destination = `/discover?q=${venue}&returnTo=%2Fsessions`;
    await login(participantPage, participant, destination);
    await expect(participantPage.getByText("No sessions found", { exact: true })).toBeVisible();

    const search = participantPage.getByRole("searchbox");
    const filters = participantPage.getByRole("button", { name: "Filters", exact: true });
    await filters.click();
    await search.fill("Unsubmitted search draft");
    await participantPage.getByLabel("Region", { exact: true }).selectOption("East");
    await participantPage.getByLabel("Date", { exact: true }).fill("2046-05-06");
    await search.focus();
    const originalUrl = participantPage.url();
    const scroll = await participantPage.evaluate(() => window.scrollY);
    const committedAt = await setThroughPage(page, venue, "PUBLIC");
    await expect(row(participantPage, venue)).toBeVisible({ timeout: Math.max(1, 3000 - (Date.now() - committedAt)) });
    expect(Date.now() - committedAt).toBeLessThanOrEqual(3000);
    await expect(search).toHaveValue("Unsubmitted search draft");
    await expect(search).toBeFocused();
    await expect(search).toBeEnabled();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(participantPage.getByLabel("Region", { exact: true })).toHaveValue("East");
    await expect(participantPage.getByLabel("Date", { exact: true })).toHaveValue("2046-05-06");
    expect(participantPage.url()).toBe(originalUrl);
    expect(await participantPage.evaluate(() => window.scrollY)).toBe(scroll);
    await expect(participantPage.getByRole("region", { name: "Upcoming sessions", exact: true })).toHaveAttribute("aria-busy", "false");
    await expect(row(page, venue).getByRole("button", { name: "Make private", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("session-visibility-mobile.png"), fullPage: true });

    const privateAt = await setThroughPage(page, venue, "PRIVATE");
    await expect(row(participantPage, venue)).toHaveCount(0, { timeout: Math.max(1, 3000 - (Date.now() - privateAt)) });
    expect(Date.now() - privateAt).toBeLessThanOrEqual(3000);
    await page.reload();
    await expect(row(page, venue).getByRole("button", { name: "Make public", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("session-visibility-desktop.png"), fullPage: true });
  } finally {
    await participantBrowser.close();
    await context.pool.end();
  }
});

test("management lists only hosted upcoming sessions, blocks full ones, and enforces API access", async ({ page, request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const booker = await context.identity(false);
    const other = await context.identity(false);
    const player = await context.identity(false);
    const prefix = `Owner-${randomUUID().slice(0, 8)}`;
    const sessionId = await insertSession(context, booker.userId, `${prefix} available`);
    const fullId = await insertSession(context, booker.userId, `${prefix} full`);
    await commitFixture(context, fullId, other);
    await commitFixture(context, fullId, player);
    const joined = await insertSession(context, other.userId, `${prefix} participant only`);
    await commitFixture(context, joined, booker);
    await insertSession(context, booker.userId, `${prefix} past`, { startAt: "2020-01-01T10:00:00Z" });
    await login(page, booker, "/sessions");
    await expect(page.getByRole("listitem")).toHaveCount(2);
    await expect(row(page, `${prefix} participant only`)).toHaveCount(0);
    await expect(row(page, `${prefix} past`)).toHaveCount(0);
    await expect(row(page, `${prefix} full`).getByRole("button", { name: "Make public", exact: true })).toBeDisabled();

    expect((await request.patch(`/api/sessions/${sessionId}/visibility`, { data: { visibility: "PUBLIC" } })).status()).toBe(401);
    expect((await patch(request, other, sessionId, "PUBLIC")).status()).toBe(403);
    const full = await patch(request, booker, fullId, "PUBLIC");
    expect(full.status()).toBe(409);
    expect(await full.json()).toMatchObject({ error: { code: "CAPACITY_EXCEEDED" } });
    expect((await request.patch(`/api/sessions/${sessionId}/visibility`, {
      headers: { Authorization: `Bearer ${booker.token}` }, data: { visibility: "everyone" },
    })).status()).toBe(400);
    expect((await patch(request, booker, randomUUID(), "PUBLIC")).status()).toBe(404);
    const changed = await patch(request, booker, sessionId, "PUBLIC");
    expect(changed.status()).toBe(200);
    expect(await changed.json()).toEqual({ sessionId, visibility: "PUBLIC" });
    expect((await patch(request, booker, sessionId, "PUBLIC")).status()).toBe(200);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [booker.userId]);
    expect((await patch(request, booker, sessionId, "PRIVATE")).status()).toBe(403);
    expect((await context.pool.query("select visibility from sessions where session_id = $1", [sessionId])).rows).toEqual([{ visibility: "PUBLIC" }]);
  } finally {
    await context.pool.end();
  }
});

test("background visibility updates preserve pagination and do not jump to an earlier newly public session", async ({ page, request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const booker = await context.identity(false);
    const participant = await context.identity(false);
    const tag = `Visibility-page-${randomUUID().slice(0, 8)}`;
    const early = await insertSession(context, booker.userId, `${tag} earlier`, { startAt: "2045-04-01T10:00:00Z" });
    let last = "";
    for (let index = 0; index < 21; index++) {
      last = await insertSession(context, booker.userId, `${tag} row ${index}`, {
        visibility: "PUBLIC", startAt: new Date(Date.UTC(2045, 3, 2, 10, index)).toISOString(),
      });
    }
    await login(page, participant, `/discover?q=${tag}&returnTo=%2Fsessions`);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/cursor=/);
    const url = page.url();
    await expect(row(page, `${tag} row 20`)).toBeVisible();
    expect((await patch(request, booker, last, "PRIVATE")).status()).toBe(200);
    await expect(row(page, `${tag} row 20`)).toHaveCount(0, { timeout: 3000 });
    // Listen before the PATCH; gate matching refresh requests on its success.
    const refreshRequest = page.waitForRequest(async (candidate) =>
      new URL(candidate.url()).pathname === "/discover" && candidate.resourceType() === "fetch" &&
      (await visibilityUpdate).status() === 200,
    );
    const visibilityUpdate = patch(request, booker, early, "PUBLIC");
    expect((await visibilityUpdate).status()).toBe(200);
    await refreshRequest;
    expect(page.url()).toBe(url);
    await expect(row(page, `${tag} earlier`)).toHaveCount(0);
    await expect(page.getByText("No sessions found", { exact: true })).toBeVisible();
  } finally {
    await context.pool.end();
  }
});

test("a delayed background refresh neither blocks draft editing nor overwrites a new query", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  let release: (() => void) | undefined;
  try {
    const participant = await context.identity(false);
    const first = `Refresh-A-${randomUUID().slice(0, 8)}`;
    const second = `Refresh-B-${randomUUID().slice(0, 8)}`;
    await insertSession(context, participant.userId, first, { visibility: "PUBLIC" });
    await insertSession(context, participant.userId, second, { visibility: "PUBLIC" });
    await login(page, participant, `/discover?q=${first}`);
    await expect(row(page, first)).toBeVisible();
    let announce: (() => void) | undefined;
    const intercepted = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let paused = false;
    await page.route("**/discover?**", async (route) => {
      if (!paused && route.request().resourceType() === "fetch" && new URL(route.request().url()).searchParams.get("q") === first) {
        paused = true;
        const response = await route.fetch();
        announce?.();
        await gate;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await intercepted;
    const input = page.getByRole("searchbox");
    await expect(input).toBeEnabled();
    await expect(row(page, first)).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming sessions", exact: true })).toHaveAttribute("aria-busy", "false");
    await input.fill(second);
    await input.press("Enter");
    release?.();
    await expect(page).toHaveURL(new RegExp(`q=${second}`));
    await expect(row(page, second)).toBeVisible();
    await expect(row(page, first)).toHaveCount(0);
    await page.unroute("**/discover?**");
    let discoveryRequestsAfterLeaving = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/discover" && request.resourceType() === "fetch") discoveryRequestsAfterLeaving++;
    });
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { name: "Sessions you host", exact: true })).toBeVisible();
    discoveryRequestsAfterLeaving = 0;
    // A deliberate two-poll observation window verifies interval teardown.
    await page.waitForTimeout(2200);
    expect(discoveryRequestsAfterLeaving).toBe(0);
  } finally {
    release?.();
    await context.pool.end();
  }
});
