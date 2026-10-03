import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function login(page: Page, identity: { email: string; password: string }, destination = "/") {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upcoming Bookings", exact: true })).toBeVisible();
}

async function insertSession(context: SessionTestContext, bookerId: string, name: string, visibility = "PRIVATE") {
  const sessionId = randomUUID();
  await context.pool.query(
    `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
     total_cost_cents, total_slots, booking_share_cents, visibility, room_token, holding_account_id)
     values ($1,$2,$3,'West','Tennis','2042-08-02T23:00:00Z','2042-08-03T00:00:00Z',1001,3,333,$4,$5,$6)`,
    [sessionId, bookerId, name, visibility, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
  return sessionId;
}

async function participate(context: SessionTestContext, sessionId: string, userId: string, status = "COMMITTED") {
  await context.pool.query(
    `insert into participations (participation_id, session_id, user_id, status, attendance, committed_at)
     values ($1,$2,$3,$4,'UNVERIFIED',$5)`,
    [randomUUID(), sessionId, userId, status, status === "COMMITTED" ? new Date() : null],
  );
}

async function expectNoHomeFilters(page: Page) {
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByLabel("Sport", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toHaveCount(0);
}

test("Home shows only owned or confirmed bookings without filters on mobile and desktop", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    const other = await context.identity(false);
    const owned = await insertSession(context, user.userId, "My private hosted court");
    await participate(context, owned, user.userId); // Owner and participant still produce one card.
    const joined = await insertSession(context, other.userId, "My confirmed private court");
    await participate(context, joined, user.userId);
    await insertSession(context, other.userId, "Someone else's private court");
    await insertSession(context, other.userId, "An unrelated public court", "PUBLIC");
    const waitlisted = await insertSession(context, other.userId, "A waitlisted court");
    await participate(context, waitlisted, user.userId, "WAITLISTED");
    // Old discovery filters and an arbitrary user ID must never affect the personal diary.
    const origin = `/?date=invalid&sport=Football&userId=${other.userId}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user, origin);
    const bookings = page.getByRole("region", { name: "Upcoming Bookings", exact: true });
    await expect(bookings.getByRole("listitem")).toHaveCount(2);
    await expect(bookings.getByText("My private hosted court", { exact: true })).toBeVisible();
    await expect(bookings.getByText("My confirmed private court", { exact: true })).toBeVisible();
    for (const name of ["Someone else's private court", "An unrelated public court", "A waitlisted court"]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "Singapore weather", exact: true })).toHaveCount(0);
    await expect(bookings.getByText("2042", { exact: true })).toHaveCount(2);
    await expect(bookings.getByLabel("3 Aug 2042", { exact: true })).toHaveCount(2);
    await expectNoHomeFilters(page);
    const navigation = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByRole("link")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("home-bookings-mobile.png"), fullPage: true });

    const accountButton = page.getByRole("button", { name: "Open account menu", exact: true });
    await accountButton.click();
    const accountMenu = page.getByRole("dialog", { name: "Your account", exact: true });
    await expect(accountMenu.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountMenu).toBeHidden();
    await expect(accountButton).toBeFocused();

    await page.getByRole("link", { name: "Search sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(origin);
    await page.getByRole("link", { name: "Back to previous page", exact: true }).click();
    await expect(bookings.getByRole("listitem")).toHaveCount(2);
    await expectNoHomeFilters(page);

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHomeFilters(page);
      await expect(bookings.getByRole("listitem")).toHaveCount(2);
      const cards = bookings.getByRole("listitem");
      const first = await cards.nth(0).boundingBox();
      const second = await cards.nth(1).boundingBox();
      if (!first || !second) throw new Error("Desktop booking cards must be visible");
      expect(Math.abs(first.y - second.y)).toBeLessThan(2);
      expect(first.x + first.width).toBeLessThanOrEqual(second.x);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(navigation.getByRole("link", { name: "Discover", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`home-bookings-desktop-${width}.png`), fullPage: true });
    }
  } finally {
    await context.pool.end();
  }
});

test("an empty Home offers weather and search on both layouts, and account logout returns to the landing", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByText("You have no upcoming bookings.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Singapore weather", exact: true })).toBeVisible();
      await expect(page.getByText("24-hour forecast", { exact: true })).toBeVisible();
      // Real forecast availability must not make the authenticated browser suite flaky.
      await expect(page.getByText("Forecast period (SGT)", { exact: true }).or(
        page.getByText("Weather is unavailable right now. You can still find a session for your next game.", { exact: true }),
      )).toBeVisible();
      await expect(page.getByRole("region", { name: "Upcoming Bookings", exact: true }).getByRole("listitem")).toHaveCount(0);
      await expectNoHomeFilters(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`home-weather-${width}.png`), fullPage: true });
    }
    await page.getByRole("link", { name: "Find a session", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to previous page", exact: true }).click();
    await expect(page.getByText("You have no upcoming bookings.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByRole("dialog", { name: "Your account", exact: true }).getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming Bookings", exact: true })).toHaveCount(0);
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
  } finally {
    await context.pool.end();
  }
});
