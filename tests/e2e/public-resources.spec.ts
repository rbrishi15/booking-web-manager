import { expect, test } from "@playwright/test";

test("serves the public landing and developer resources without service configuration", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toBeVisible();
  for (const href of ["/api-docs", "/api/openapi", "/storybook"]) {
    const link = page.locator(`a[href="${href}"]`);
    await expect(link).toBeVisible();
    const response = await request.get(href);
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).not.toBe("/login");
  }

  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.load('900 20px "Inter"');
    return document.fonts.check('900 20px "Inter"');
  })).toBe(true);
});

test("preserves Storybook deep links and renders its manager, iframe, and local assets anonymously", async ({ page, request }) => {
  const storyId = "foundations-booking-logo--default";
  const response = await request.get(`/storybook?path=/story/${storyId}`, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const destination = new URL(response.headers().location!, response.url());
  expect(destination.pathname).toBe("/storybook/index.html");
  expect(destination.searchParams.get("path")).toBe(`/story/${storyId}`);

  const failedAssets: string[] = [];
  page.on("response", (asset) => {
    if (asset.status() >= 400 && new URL(asset.url()).origin === "http://127.0.0.1:3100") {
      failedAssets.push(`${asset.status()} ${new URL(asset.url()).pathname}`);
    }
  });
  await page.goto(`/storybook?path=/story/${storyId}`);
  await expect(page).toHaveURL(new RegExp(`/storybook/index\\.html\\?path=/story/${storyId}$`));
  const canvas = page.frameLocator("#storybook-preview-iframe");
  await expect(canvas.getByText("Booking.", { exact: true })).toBeVisible();

  for (const path of [
    "/storybook/index.json",
    "/storybook/iframe.html",
    "/storybook/fonts/inter-v20-latin.woff2",
    "/storybook/images/mobile-hero.png",
    "/storybook/images/sports/tennis.jpg",
    "/fonts/inter-v20-latin.woff2",
    "/images/mobile-hero.png",
  ]) {
    const asset = await request.get(path);
    expect(asset.ok(), path).toBe(true);
    expect(new URL(asset.url()).pathname).toBe(path);
  }
  expect(failedAssets).toEqual([]);
});
