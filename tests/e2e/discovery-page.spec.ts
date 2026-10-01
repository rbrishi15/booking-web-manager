import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "../../lib/money/constants";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function login(page: Page, identity: { email: string; password: string }, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover sessions", exact: true })).toBeVisible();
}

async function insertSession(context: SessionTestContext, bookerId: string, input: {
  name: string;
  startAt: string;
  sessionId?: string;
  region?: string;
  sport?: string;
}) {
  const sessionId = input.sessionId ?? randomUUID();
  await context.pool.query(
    `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
     total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, room_token, holding_account_id)
     values ($1,$2,$3,$4,$5,$6,$7,1001,3,2,333,'PUBLIC',$8,$9)`,
    [sessionId, bookerId, input.name, input.region ?? "West", input.sport ?? "Badminton", input.startAt,
      new Date(new Date(input.startAt).getTime() + 2 * 60 * 60 * 1000), randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
}

test("signed-in Home applies URL filters, preserves history and fits a 390px screen", async ({ page }, testInfo) => {
  const context = sessionTestContext();
  let releaseRequest: (() => void) | undefined;
  try {
    const user = await context.identity(false);
    await insertSession(context, user.userId, { name: "West evening badminton", startAt: "2042-08-02T10:00:00Z" });
    await insertSession(context, user.userId, { name: "East evening tennis", startAt: "2042-08-02T10:00:00Z", region: "East", sport: "Tennis" });
    await insertSession(context, user.userId, { name: "Following day badminton", startAt: "2042-08-03T10:00:00Z" });
    await login(page, user, "/?date=2042-08-02");
    await expect(page.getByText("West evening badminton", { exact: true })).toBeVisible();
    await expect(page.getByText("East evening tennis", { exact: true })).toBeVisible();
    await expect(page.getByText("Following day badminton", { exact: true })).toHaveCount(0);
    const desktopResults = page.getByRole("region", { name: "Upcoming sessions" });
    const desktopCards = desktopResults.getByRole("listitem");
    const desktopImages = desktopResults.locator("img");
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole("heading", { name: "Booking.", exact: true })).toBeVisible();
      await expect(desktopCards).toHaveCount(2);
      await expect(desktopImages).toHaveCount(2);
      for (const image of await desktopImages.all()) {
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute("alt", "");
        expect(decodeURIComponent(await image.getAttribute("src") ?? "")).toContain("/images/sports/");
      }
      await expect.poll(() => desktopImages.evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
      )).toBe(true);
      // Both results remain readable in one row at normal desktop widths.
      const firstCard = await desktopCards.nth(0).boundingBox();
      const secondCard = await desktopCards.nth(1).boundingBox();
      expect(firstCard).not.toBeNull();
      expect(secondCard).not.toBeNull();
      if (!firstCard || !secondCard) throw new Error("The desktop session cards must be visible");
      expect(Math.abs(firstCard.y - secondCard.y)).toBeLessThan(2);
      expect(firstCard.x + firstCard.width).toBeLessThanOrEqual(secondCard.x);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`discovery-desktop-${width}.png`), fullPage: true });
    }
    await page.getByLabel("Sport", { exact: true }).selectOption("Badminton");
    await page.getByLabel("Region", { exact: true }).selectOption("West");
    await page.getByLabel("From", { exact: true }).fill("18:00");
    await page.getByLabel("To", { exact: true }).fill("19:00");
    // Hold the actual navigation response so pending feedback is checked deterministically.
    const gate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let pauseNext = true;
    await page.route("**/?**", async (route) => {
      if (pauseNext && route.request().resourceType() === "fetch") {
        pauseNext = false;
        await gate;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Loading sessions");
    await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeDisabled();
    releaseRequest?.();
    await expect(page).toHaveURL(/sport=Badminton/);
    await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeEnabled();
    await page.unroute("**/?**");
    await expect(page.getByText("West evening badminton", { exact: true })).toBeVisible();
    await expect(page.getByText("East evening tennis", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Upcoming sessions" }).locator("a")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("discovery-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeHidden();
    const navigation = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByRole("link", { name: "Sessions", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Wallet", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(4);
    const sessionImage = page.getByRole("region", { name: "Upcoming sessions" }).locator("img");
    await expect(sessionImage).toHaveCount(1);
    await expect(sessionImage).toHaveAttribute("alt", "");
    expect(decodeURIComponent(await sessionImage.getAttribute("src") ?? "")).toContain("/images/sports/");
    await expect.poll(() => sessionImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("discovery-mobile.png"), fullPage: true });

    const accountButton = page.getByRole("button", { name: "Open account menu", exact: true });
    await accountButton.click();
    const accountMenu = page.getByRole("dialog", { name: "Your account", exact: true });
    await expect(accountMenu.getByRole("link", { name: "My groups", exact: true })).toHaveAttribute("href", "/groups");
    await expect(accountMenu.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountMenu).toBeHidden();
    await expect(accountButton).toBeFocused();

    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await page.getByLabel("Sport", { exact: true }).selectOption("Tennis");
    await filters.click();
    await expect(page.getByLabel("Sport", { exact: true })).toBeHidden();
    await filters.click();
    await expect(page.getByLabel("Sport", { exact: true })).toHaveValue("Tennis");
    await expect(page.getByText("West evening badminton", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("sport")).toBe("Badminton");

    await page.goBack();
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await expect(page.getByLabel("Sport", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Region", { exact: true })).toHaveValue("");
    await expect(page.getByText("East evening tennis", { exact: true })).toBeVisible();
    await page.goForward();
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await expect(page.getByLabel("Sport", { exact: true })).toHaveValue("Badminton");
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("18:00");

    await page.getByLabel("Sport", { exact: true }).selectOption("Tennis");
    await page.getByLabel("Region", { exact: true }).selectOption("East");
    const mobileGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    let pauseMobile = true;
    await page.route("**/?**", async (route) => {
      if (pauseMobile && route.request().resourceType() === "fetch") {
        pauseMobile = false;
        await mobileGate;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Loading sessions");
    await expect(page.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "true");
    await expect(filters).toBeDisabled();
    await expect(page.getByLabel("Sport", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Date", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toBeDisabled();
    releaseRequest?.();
    await expect(page).toHaveURL(/sport=Tennis/);
    await page.unroute("**/?**");
    await expect(page.getByText("East evening tennis", { exact: true })).toBeVisible();
    await expect(page.getByText("West evening badminton", { exact: true })).toHaveCount(0);
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Sport", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    releaseRequest?.();
    await context.pool.end();
  }
});

test("Home pagination keeps filters and changing filters resets the cursor", async ({ page }) => {
  const context = sessionTestContext();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const user = await context.identity(false);
    const ids = Array.from({ length: 21 }, () => randomUUID()).sort();
    for (const [index, sessionId] of ids.entries()) {
      await insertSession(context, user.userId, {
        name: `Discovery page row ${String(index + 1).padStart(2, "0")}`,
        startAt: "2042-08-04T10:00:00Z", sessionId,
      });
    }
    await login(page, user, "/?date=2042-08-04&region=West");
    await expect(page.getByText("Discovery page row 01", { exact: true })).toBeVisible();
    await expect(page.getByText("Discovery page row 21", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/cursor=/);
    expect(new URL(page.url()).searchParams.get("date")).toBe("2042-08-04");
    expect(new URL(page.url()).searchParams.get("region")).toBe("West");
    await expect(page.getByText("Discovery page row 21", { exact: true })).toBeVisible();
    await expect(page.getByText("Discovery page row 01", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next page", exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText("Discovery page row 01", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByText("Discovery page row 21", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Region", { exact: true }).selectOption("East");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.getByText("No sessions found", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
    await expect(page.getByLabel("Region", { exact: true })).toHaveValue("East");
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute("aria-expanded", "false");
  } finally {
    await context.pool.end();
  }
});

test("Home malformed filters remain correctable and logout returns to the public landing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover?date=2042-08-05");
  await expect(page).toHaveURL(/\/login\?next=/);
  const context = sessionTestContext();
  try {
    const user = await context.identity(false);
    await login(page, user, "/?date=invalid");
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue("");
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.click();
    await page.getByLabel("From", { exact: true }).fill("18:00");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Date", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Date", { exact: true }).fill("2042-08-05");
    await expect(page.getByLabel("Date", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/date=2042-08-05/);
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByRole("dialog", { name: "Your account", exact: true }).getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/login\?next=/);
  } finally {
    await context.pool.end();
  }
});
