import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function login(page: Page, identity: { email: string; password: string }, destination = "/") {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Upcoming bookings$/i })).toBeVisible();
}

async function insertSession(context: SessionTestContext, bookerId: string, name: string, visibility = "PRIVATE") {
  const sessionId = randomUUID();
  await context.pool.query(
    `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
     total_cost_cents, total_slots, booking_share_cents, visibility, room_token, holding_account_id)
     values ($1,$2,$3,'West','Tennis','2042-08-02T23:00:00Z','2042-08-03T00:00:00Z',1001,4,333,$4,$5,$6)`,
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

test("Home separates personal bookings from mobile discovery and keeps desktop navigation", async ({ page }, testInfo) => {
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
    const bookings = page.getByRole("region", { name: /^Upcoming bookings$/i });
    await expect(page.getByRole("heading", { name: "Upcoming Bookings", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Make time to play\./ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Find a session", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Host a session", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View all hosted sessions", exact: true })).toHaveCount(0);
    await expect(bookings.getByRole("listitem")).toHaveCount(2);
    await expect(bookings.getByText("My private hosted court", { exact: true })).toBeVisible();
    await expect(bookings.getByText("My confirmed private court", { exact: true })).toBeVisible();
    for (const name of ["Someone else's private court", "An unrelated public court", "A waitlisted court"]) {
      await expect(bookings.getByText(name, { exact: true })).toHaveCount(0);
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

    await expect(page.getByRole("link", { name: /^Notifications/ })).toHaveAttribute("href", "/notifications");
    await expect(page.getByRole("link", { name: "Search sessions", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open account menu", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Discover Bookings", exact: true })).toBeVisible();
    await expect(page.getByText("Someone else's private court", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(new URL(origin, page.url()).href);

    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHomeFilters(page);
      await expect(page.getByRole("heading", { name: /Make time to play\./, level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Upcoming bookings", level: 2, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Find a session", exact: true })).toHaveAttribute("href", "/discover?returnTo=%2F");
      await expect(page.getByRole("link", { name: "Host a session", exact: true })).toHaveAttribute("href", "/sessions/create");
      await expect(page.getByRole("link", { name: "View all hosted sessions", exact: true })).toHaveAttribute("href", "/sessions");
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

test("an empty Home offers weather and discovery, and Settings logout returns to the landing", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user);
    for (const width of [390, 767, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const mobile = width < 768;
      await expect(page.getByRole("heading", { name: mobile ? "Upcoming Bookings" : "Upcoming bookings", level: mobile ? 1 : 2, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Make time to play\./, level: 1 })).toHaveCount(mobile ? 0 : 1);
      await expect(page.getByRole("link", { name: "View all hosted sessions", exact: true })).toHaveCount(mobile ? 0 : 1);
      await expect(page.getByText("You have no upcoming bookings.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Singapore weather", exact: true })).toHaveCount(1);
      // Real forecast availability must not make the authenticated browser suite flaky.
      const forecastDetails = page.getByLabel(/^Forecast details:/).filter({ visible: true });
      const forecastPeriod = page.getByText("Forecast period (SGT)", { exact: true }).filter({ visible: true });
      if (mobile) await expect(forecastDetails).toHaveCount(0);
      if (await forecastDetails.count() > 0) {
        if (await forecastPeriod.count() > 0) await forecastDetails.click();
        await expect(forecastPeriod).toHaveCount(0);
        await forecastDetails.click();
      }
      if (await forecastPeriod.count() > 0) {
        await expect(page.getByText("Updated", { exact: true }).filter({ visible: true })).toBeVisible();
        await expect(page.getByRole("link", { name: /Source: NEA/ })).toHaveAttribute("href", "https://data.gov.sg/datasets/d_ce2eb1e307bda31993c533285834ef2b/view");
        await expect(page.getByRole("link", { name: /Singapore Open Data Licence/ })).toBeVisible();
      } else {
        await expect(page.getByText(/Weather is unavailable right now/).filter({ visible: true })).toBeVisible();
      }
      const findLinks = page.getByRole("link", { name: "Find a session", exact: true });
      const hostLinks = page.getByRole("link", { name: "Host a session", exact: true });
      await expect(findLinks).toHaveCount(mobile ? 1 : 2);
      await expect(hostLinks).toHaveCount(mobile ? 0 : 2);
      for (let index = 0; index < await findLinks.count(); index += 1) {
        await expect(findLinks.nth(index)).toHaveAttribute("href", mobile ? "#discover-bookings" : "/discover?returnTo=%2F");
      }
      for (let index = 0; index < await hostLinks.count(); index += 1) {
        await expect(hostLinks.nth(index)).toHaveAttribute("href", "/sessions/create");
      }
      await expect(page.getByRole("region", { name: /^Upcoming bookings$/i }).getByRole("listitem")).toHaveCount(0);
      await expectNoHomeFilters(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`home-weather-${width}.png`), fullPage: true });
    }
    await page.getByRole("link", { name: "Find a session", exact: true }).first().click();
    // The viewport is still 1280px: desktop Discover uses sidebar navigation,
    // not the mobile-only back link or the mobile "Find Your Next Game" heading.
    await expect(page.getByRole("heading", { name: "Upcoming sessions", exact: true })).toBeVisible();
    const desktopNavigation = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(desktopNavigation.getByRole("link", { name: "Discover", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Back to previous page", exact: true })).toHaveCount(0);
    await desktopNavigation.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByText("You have no upcoming bookings.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByLabel("Open navigation menu", { exact: true }).click();
    const signIn = page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Sign in", exact: true });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", "/login");
    await expect(page.getByRole("heading", { name: /^Upcoming bookings$/i })).toHaveCount(0);
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/discover");
    await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
  } finally {
    await context.pool.end();
  }
});
