import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function expectLocation(page: Page, destination: string) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }).toBe(destination);
}

async function login(page: Page, identity: { email: string; password: string }, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expectLocation(page, destination);
}

async function insertSession(context: SessionTestContext, bookerId: string, input: {
  name: string;
  startAt: string;
  sessionId?: string;
  sport?: string;
  region?: string;
}) {
  await context.pool.query(
    `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
     total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, room_token, holding_account_id)
     values ($1,$2,$3,$4,$5,$6,$7,1001,3,2,333,'PUBLIC',$8,$9)`,
    [input.sessionId ?? randomUUID(), bookerId, input.name, input.region ?? "West", input.sport ?? "Badminton", input.startAt,
      new Date(new Date(input.startAt).getTime() + 2 * 60 * 60 * 1000), randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
}

test("mobile search preserves drafts and history, disables pending actions, and returns to filtered Home", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  let releaseRequest: (() => void) | undefined;
  try {
    const user = await context.identity(false);
    const tag = `Court-${randomUUID().slice(0, 8)}`;
    const westVenue = `${tag} West badminton court`;
    const eastVenue = `${tag} East tennis court`;
    await insertSession(context, user.userId, { name: westVenue, startAt: "2043-04-01T10:00:00Z" });
    await insertSession(context, user.userId, { name: eastVenue, startAt: "2043-04-01T10:00:00Z", sport: "Tennis", region: "East" });
    const origin = "/?date=2043-04-01&region=West";
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user, origin);
    await page.getByRole("link", { name: "Search sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(origin);
    await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeHidden();

    const input = page.getByRole("searchbox", { name: "Search sports or venues", exact: true });
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    const sports = page.getByRole("group", { name: "Choose a sport", exact: true });
    const results = page.getByRole("region", { name: "Upcoming sessions", exact: true });
    await input.fill(tag.toLowerCase());
    await expect(filters).toHaveAttribute("aria-expanded", "false");

    const gate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let pauseNext = true;
    await page.route("**/discover?**", async (route) => {
      if (pauseNext && route.request().resourceType() === "fetch") {
        pauseNext = false;
        await gate;
      }
      await route.continue();
    });
    await sports.getByRole("button", { name: "Badminton", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Loading sessions");
    await expect(results).toHaveAttribute("aria-busy", "true");
    await expect(input).toBeDisabled();
    await expect(filters).toBeDisabled();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
    await expect(sports.getByRole("button", { name: "Tennis", exact: true })).toBeDisabled();
    releaseRequest?.();
    await expect(page).toHaveURL(/sport=Badminton/);
    await expect(input).toBeEnabled();
    await page.unroute("**/discover?**");
    expect(new URL(page.url()).searchParams.get("q")).toBe(tag.toLowerCase());
    await expect(results.getByText(westVenue, { exact: false })).toBeVisible();
    await expect(results.getByText(eastVenue, { exact: false })).toHaveCount(0);

    await filters.click();
    await page.getByLabel("Region", { exact: true }).selectOption("West");
    await page.getByLabel("From", { exact: true }).fill("18:00");
    await page.getByLabel("To", { exact: true }).fill("19:00");
    await filters.click();
    await expect(page.getByLabel("From", { exact: true })).toBeHidden();
    await filters.click();
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("18:00");
    await expect(page.getByLabel("Region", { exact: true })).toHaveValue("West");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.getByLabel("Date", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(new URL(page.url()).searchParams.has("timeFrom")).toBe(false);
    await page.getByLabel("Date", { exact: true }).fill("2043-04-01");
    await expect(page.getByLabel("Date", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/timeFrom=18%3A00/);
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(results.getByRole("listitem")).toHaveCount(1);

    await page.goBack();
    await expect(page).not.toHaveURL(/timeFrom=/);
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveValue(tag.toLowerCase());
    await filters.click();
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Region", { exact: true })).toHaveValue("");
    await page.goForward();
    await expect(page).toHaveURL(/timeFrom=18%3A00/);
    await expect(filters).toHaveAttribute("aria-expanded", "false");

    const image = results.locator("img");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("alt", "");
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("discover-search-mobile.png"), fullPage: true });

    await filters.click();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => [...new URL(page.url()).searchParams.keys()]).toEqual(["returnTo"]);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(origin);
    await page.reload();
    await page.getByRole("link", { name: "Back to previous page", exact: true }).click();
    await expectLocation(page, origin);
    await expect(page.getByRole("heading", { name: "Discover sessions", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    releaseRequest?.();
    await context.pool.end();
  }
});

test("search pagination preserves the query and return destination while sport changes reset the cursor", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    const tag = `Search-page-${randomUUID().slice(0, 8)}`;
    const ids = Array.from({ length: 21 }, () => randomUUID()).sort();
    for (const [index, sessionId] of ids.entries()) {
      await insertSession(context, user.userId, {
        name: `${tag} row ${String(index + 1).padStart(2, "0")}`,
        startAt: "2043-04-02T10:00:00Z", sessionId,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const origin = "/?date=2043-04-02";
    await login(page, user, origin);
    await page.getByRole("link", { name: "Search sessions", exact: true }).click();
    const input = page.getByRole("searchbox", { name: "Search sports or venues", exact: true });
    const results = page.getByRole("region", { name: "Upcoming sessions", exact: true });
    await input.fill(tag);
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${tag}`));
    await expect(results.getByRole("listitem")).toHaveCount(20);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Date", { exact: true }).fill("2043-04-02");
    await page.getByLabel("Region", { exact: true }).selectOption("West");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/region=West/);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/cursor=/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe(tag);
    expect(params.get("date")).toBe("2043-04-02");
    expect(params.get("region")).toBe("West");
    expect(params.get("returnTo")).toBe(origin);
    await expect(results.getByRole("listitem")).toHaveCount(1);
    await expect(results.getByText(`${tag} row 21`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next page", exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(results.getByRole("listitem")).toHaveCount(20);
    await expect(results.getByText(`${tag} row 01`, { exact: false })).toBeVisible();
    await page.goForward();
    await expect(results.getByText(`${tag} row 21`, { exact: false })).toBeVisible();
    await page.getByRole("group", { name: "Choose a sport", exact: true }).getByRole("button", { name: "Tennis", exact: true }).click();
    await expect(page.getByText("No sessions found", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
    expect(new URL(page.url()).searchParams.get("q")).toBe(tag);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(origin);
    await page.getByRole("link", { name: "Back to previous page", exact: true }).click();
    await expectLocation(page, origin);
  } finally {
    await context.pool.end();
  }
});

test("Discover returns to another app page and uses Home for direct or rejected return destinations", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    const origin = "/profile?from=discovery-search";
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user, origin);
    await page.getByRole("link", { name: "Search sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(origin);
    await page.reload();
    await page.getByRole("link", { name: "Back to previous page", exact: true }).click();
    await expectLocation(page, origin);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    for (const returnTo of ["https://example.com/", "/login?next=/", "/discover?q=loop"]) {
      await page.goto(`/discover?returnTo=${encodeURIComponent(returnTo)}`);
      const back = page.getByRole("link", { name: "Back to previous page", exact: true });
      await expect(back).toHaveAttribute("href", "/");
      await back.click();
      await expectLocation(page, "/");
    }

    await page.goto("/discover");
    await expect(page.getByRole("link", { name: "Back to previous page", exact: true })).toHaveAttribute("href", "/");
    await page.setViewportSize({ width: 1280, height: 1000 });
    const navigation = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(navigation.getByRole("link", { name: "Discover", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByRole("link", { name: "Home", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search sports or venues" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("discover-search-desktop.png") });
  } finally {
    await context.pool.end();
  }
});
