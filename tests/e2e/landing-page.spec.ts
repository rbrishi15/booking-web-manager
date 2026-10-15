import { expect, test } from "@playwright/test";

test("landing navigation stays usable without horizontal overflow on mobile, tablet, and desktop", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Find your next game.", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse sessions", exact: true })).toHaveAttribute("href", "/discover");
    const mobileMenu = page.getByLabel("Open navigation menu", { exact: true });
    const isMobile = await mobileMenu.isVisible();
    if (isMobile) await mobileMenu.click();
    await expect(page.getByRole("link", { name: isMobile ? "Sign in" : "Log in", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Create account", exact: true })).toHaveAttribute("href", "/register");
    await expect(page.locator('a[href="/sessions/create"]:visible').first()).toBeVisible();
    await expect(page.locator('a[href="/discover?sport=Tennis"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByRole("link", { name: "How it works", exact: true }).click();
    await expect(page).toHaveURL(/\/#how-it-works$/);
    await expect(page.locator("#how-it-works")).toBeInViewport();
  }

  await page.locator('a[href="/discover?sport=Tennis"]').first().click();
  await expect(page).toHaveURL(/\/discover\?sport=Tennis$/);
  await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
});

test("the keyboard skip link moves past navigation to the primary action", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#landing-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Browse sessions", exact: true })).toBeFocused();
  }
});

test("the hero action and practical details do not overlap at short and wide desktop sizes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1599, height: 768 }, { width: 1920, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const action = page.getByRole("link", { name: "Browse sessions", exact: true });
    const facts = page.getByRole("list", { name: "What you can do with Booking", exact: true });
    await expect(action).toBeVisible();
    await expect(facts).toBeVisible();
    const actionBounds = await action.boundingBox();
    const factsBounds = await facts.boundingBox();
    expect(actionBounds).not.toBeNull();
    expect(factsBounds).not.toBeNull();
    expect(actionBounds!.y + actionBounds!.height, `Hero action overlaps practical details at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(factsBounds!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("the hero loads the intended mobile and desktop artwork", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const artwork = page.getByRole("region", { name: "Find your next game.", exact: true }).locator("picture img");
    await expect(artwork).toBeVisible();
    await expect.poll(() => artwork.evaluate((image) => image instanceof HTMLImageElement ? image.naturalWidth : 0)).toBeGreaterThan(0);
    const source = await artwork.evaluate((image) => image instanceof HTMLImageElement ? image.currentSrc : "");
    expect(new URL(source).pathname).toBe(width < 700 ? "/images/landing-court-mobile.webp" : "/images/landing-court.webp");
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the landing copy and primary discovery link remain usable", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      await expect(page.getByRole("heading", { name: "Find your next game.", exact: true })).toBeVisible();
      const mobileMenu = page.getByLabel("Open navigation menu", { exact: true });
      const isMobile = await mobileMenu.isVisible();
      if (isMobile) await mobileMenu.click();
      await expect(page.getByRole("link", { name: isMobile ? "Sign in" : "Log in", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Create account", exact: true })).toBeVisible();
      if (isMobile) await mobileMenu.click();
      await page.getByRole("link", { name: "Browse sessions", exact: true }).click();
      await expect(page).toHaveURL(/\/discover$/);
      await expect(page.getByRole("heading", { name: "Find Your Next Game", exact: true })).toBeVisible();
    }
  });
});
