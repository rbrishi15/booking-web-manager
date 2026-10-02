import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";
import { pendingStorageKey } from "../../app/sessions/create/model";

type Identity = Awaited<ReturnType<SessionTestContext["identity"]>>;
async function login(page: Page, identity: Identity, destination = "/sessions") {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination.replace(/[?]/g, "\\?")}$`));
}
async function details(page: Page, venue: string) {
  await page.getByRole("button", { name: "Enter venue manually", exact: true }).click();
  await page.getByRole("combobox", { name: "Venue", exact: true }).fill(venue);
  await page.getByRole("combobox", { name: "Region", exact: true }).click();
  await page.getByRole("option", { name: "West", exact: true }).click();
  await page.getByRole("button", { name: "Edit booking dates and times" }).click();
  await page.getByLabel("Start date", { exact: true }).fill("2045-06-17");
  await page.getByLabel("Start time", { exact: true }).fill("23:00");
  await page.getByLabel("End date", { exact: true }).fill("2045-06-18");
  await page.getByLabel("End time", { exact: true }).fill("01:00");
  await page.getByRole("button", { name: "Save dates and times" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Booking cost (SGD)").fill("60.00");
}
async function pricing(page: Page, venue: string) {
  await details(page, venue);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Adjust price per slot (SGD)").fill("12.01");
}

test("UC2-02 validates, creates a custom-priced overnight booking and refreshes the hosted list", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const booker = await context.identity();
    const venue = `Create-${randomUUID().slice(0, 8)}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, booker);
    await expect(page.getByText("No upcoming sessions to manage")).toBeVisible();
    await page.getByRole("link", { name: "Create a session", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Booked Venue Details" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main", exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toBeFocused();
    await expect(page.getByText("Enter or select a venue.")).toBeVisible();
    await page.getByRole("combobox", { name: "Venue", exact: true }).fill("Court");
    await expect(page.getByText("Venue search is unavailable. Enter the venue and region manually.")).toBeVisible();
    await details(page, venue);
    await page.screenshot({ path: testInfo.outputPath("details-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Booked Venue Settings" })).toBeFocused();
    await page.getByRole("combobox", { name: "Room Visibility" }).click();
    await page.getByRole("option", { name: "Public", exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("settings-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Adjust price per slot (SGD)").fill("12.01");
    await expect(page.getByRole("status")).toHaveText("S$96.08");
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const photo = page.locator('section[aria-label="Create a session"] img');
      const bounds = await photo.boundingBox();
      expect(bounds!.width / bounds!.height).toBeCloseTo(width < 768 ? 1.5 : 2, 1);
      await page.screenshot({ path: testInfo.outputPath(`pricing-${width}.png`), fullPage: true });
    }
    await page.getByLabel("Price per slot slider").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("Adjust price per slot (SGD)")).toHaveValue("12.02");
    const result = page.waitForResponse((response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect((await result).status()).toBe(201);
    expect((await result).request().postDataJSON().config).toEqual({
      totalSlots: 8, visibility: "PUBLIC", minimumReliability: 90, pricePerSlotCents: 1202,
    });
    await expect(page).toHaveURL(/\/sessions\?created=1$/);
    await expect(page.getByRole("status")).toHaveText("Your session was created successfully.");
    await expect(page.getByRole("article", { name: `Tennis at ${venue}` })).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingStorageKey(booker.userId))).toBeNull();
    expect((await context.pool.query("select booking_share_cents, minimum_reliability, total_slots, start_at, end_at from sessions where booker_id = $1", [booker.userId])).rows).toEqual([{
      booking_share_cents: "1202", minimum_reliability: "90", total_slots: 8,
      start_at: new Date("2045-06-17T15:00:00Z"), end_at: new Date("2045-06-17T17:00:00Z"),
    }]);
  } finally { await context.pool.end(); }
});

test("a committed request with a lost response is frozen, restored on reload, and replayed once", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const booker = await context.identity();
    const venue = `Replay-${randomUUID().slice(0, 8)}`;
    await login(page, booker, "/sessions/create");
    await pricing(page, venue);
    const submissions: unknown[] = [];
    await page.route("**/api/sessions", async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry submission" })).toBeVisible();
    await expect(page.getByLabel("Adjust price per slot (SGD)")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Auto-Generated Pricing" })).toBeVisible();
    await expect(page.getByLabel("Adjust price per slot (SGD)")).toHaveValue("12.01");
    await expect(page.getByLabel("Adjust price per slot (SGD)")).toBeDisabled();
    await page.getByRole("button", { name: "Retry submission" }).click();
    await expect(page).toHaveURL(/\/sessions\?created=1$/);
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect((await context.pool.query("select count(*)::int as count from sessions where booker_id = $1", [booker.userId])).rows).toEqual([{ count: 1 }]);
  } finally { await context.pool.end(); }
});

test("payout readiness and server validation reject creation visibly without persisting a session", async ({ page, request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const booker = await context.identity(false);
    await login(page, booker, "/sessions/create");
    await pricing(page, "Payout not ready court");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("region", { name: "Create a session" }).getByRole("alert")).toHaveText("Complete your payout account setup before creating a session.");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
    const ready = await context.identity();
    const invalid = await request.post("/api/sessions", { headers: { Authorization: `Bearer ${ready.token}` }, data: {
      idempotencyKey: randomUUID(), booking: { venueName: "Court", region: "West", sport: "Tennis", startAt: "2045-06-17T07:00:00+08:00", endAt: "2045-06-17T08:00:00+08:00", totalCostCents: 6000 },
      config: { totalSlots: 8, pricePerSlotCents: 1501 },
    } });
    expect(invalid.status()).toBe(422);
    expect((await context.pool.query("select count(*)::int as count from sessions where booker_id = any($1::uuid[])", [[booker.userId, ready.userId]])).rows).toEqual([{ count: 0 }]);
  } finally { await context.pool.end(); }
});

test("venue fixtures support pagination, keyboard selection and manual region fallback on a short screen", async ({ page }) => {
  const context = sessionTestContext();
  try {
    const booker = await context.identity(false);
    await page.setViewportSize({ width: 390, height: 600 });
    await login(page, booker, "/sessions/create");
    await page.route("**/api/venues?**", async (route) => {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      const pageNumber = new URL(route.request().url()).searchParams.get("page");
      await route.fulfill({ json: { items: [{ venueName: pageNumber === "2" ? "Second booked court" : "First booked court", address: "Fixture address", postalCode: "", latitude: 1.33, longitude: 103.74, region: pageNumber === "2" ? null : "West" }], nextPage: pageNumber === "2" ? null : 2 } });
    });
    const input = page.getByRole("combobox", { name: "Venue", exact: true });
    await input.fill("Court");
    await expect(page.getByRole("option", { name: /First booked court/ })).toBeVisible();
    await page.getByRole("button", { name: "More venues" }).click();
    await expect(page.getByRole("option", { name: /Second booked court/ })).toBeVisible();
    await input.focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await expect(input).toHaveValue("Second booked court");
    await expect(page.getByText("Venue found. Choose a region below to continue.")).toBeVisible();
    await page.getByRole("combobox", { name: "Region", exact: true }).click();
    await page.getByRole("option", { name: "East", exact: true }).click();
    await input.fill("Edited court");
    await expect(page.getByLabel("Venue selected from OneMap")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Region", exact: true })).toHaveText("Choose a region");
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  } finally { await context.pool.end(); }
});
