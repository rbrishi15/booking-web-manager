import { expect, test } from "@playwright/test";

/**
 * Regression for a passing Next/Storybook build whose browser preview still
 * crashed with "Buffer is not defined". Assert actual rendering in Chromium.
 */
test("session participant desktop Storybook renders in the browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-participant-removal--desktop");
  await expect(page.getByRole("heading", { name: "Badminton Session" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Participants (2)" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("new invitation modals render without server-only dependencies", async ({ page }) => {
  for (const [storyId, title] of [
    ["sessions-player-invitations--invite-by-user-id", "Invite players"],
    ["sessions-player-invitations--import-from-group", "Import from group"],
  ] as const) {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    page.on("pageerror", onError);
    await page.goto(`/storybook/iframe.html?viewMode=story&id=${storyId}`);
    await expect(page.getByRole("dialog")).toContainText(title);
    expect(errors).toEqual([]);
    page.off("pageerror", onError);
  }
});

test("light mode participant action menu has readable foreground and background", async ({ page }) => {
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-participant-removal--light-mode-menu");
  const menuItem = page.getByRole("button", { name: "Remove participant" });
  await expect(menuItem).toBeVisible();
  await expect(menuItem).toHaveCSS("color", "rgb(21, 25, 32)");
  await expect(menuItem.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("light player management follows the supplied layout and sans-serif participant names", async ({ page }) => {
  await page.setViewportSize({ width: 1798, height: 875 });
  await page.clock.setFixedTime(new Date("2026-11-04T04:00:00Z"));
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-management--light");
  const summary = page.getByRole("region", { name: "Session details", exact: true });
  await expect(summary).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const bounds = (await summary.boundingBox())!;
  expect(bounds.x).toBeCloseTo(332, 0);
  expect(bounds.y).toBeCloseTo(323, 0);
  expect(bounds.height).toBeCloseTo(147, 0);
  await expect(summary.locator("..")).toHaveCSS("background-color", "rgb(252, 248, 245)");
  await expect(page.getByRole("list", { name: "Participants" }).getByText("Tian Pok Neoh", { exact: true })).toHaveCSS("font-family", /Inter.*sans-serif/);
  await expect(page.getByRole("progressbar", { name: "Session occupancy" }).locator("span")).toHaveCSS("background-color", "rgb(20, 26, 29)");
  await expect(summary).toContainText("6 Nov 2026");
  await expect(page.getByRole("complementary")).toBeVisible();
});

test("booker can queue exact IDs, reject duplicates, and send invitations", async ({ page }) => {
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-invitations--invite-by-user-id");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("User ID", { exact: true }).fill("@Alice_01");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Players selected for invitations" })).toContainText("@alice_01");
  await dialog.getByLabel("User ID", { exact: true }).fill("alice_01");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("already on the list");
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Invite players", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("1 invitations sent (simulated).");
});

test("dark player management matches the supplied card, tabs, and participant positions", async ({ page }) => {
  await page.setViewportSize({ width: 1714, height: 918 });
  await page.clock.setFixedTime(new Date("2026-11-04T04:00:00Z"));
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-management--dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const summary = page.getByRole("region", { name: "Session details", exact: true });
  await expect(summary).toBeVisible();
  const bounds = (await summary.boundingBox())!;
  expect(bounds.x).toBeCloseTo(315, 0);
  expect(bounds.y).toBeCloseTo(265, 0);
  expect(bounds.width).toBeCloseTo(1347, 0);
  expect(bounds.height).toBeGreaterThanOrEqual(145);
  expect(bounds.height).toBeLessThan(147);
  await expect(summary.locator("..")).toHaveCSS("background-color", "rgb(6, 8, 14)");
  const participants = page.getByRole("list", { name: "Participants" });
  expect((await participants.boundingBox())!.y).toBeGreaterThan(550);
  await expect(participants.getByText("Tian Pok Neoh", { exact: true })).toHaveCSS("font-family", /Inter.*sans-serif/);
  await expect(summary).toContainText("6 Nov 2026");
});

test("invite links remain usable when clipboard permission is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Permission denied"); } } });
  });
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-invitations--invite-by-user-id");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "By invite link" }).click();
  await dialog.getByRole("button", { name: "Copy invite link", exact: true }).click();
  await expect(dialog.getByLabel("Session invitation link", { exact: true })).toHaveValue(/\/sessions\/.+\/join\?token=storybook-only$/);
  await expect(dialog.getByRole("status")).toContainText("Copy the invitation link below");
});

test("group imports send only selected members and fit a 390px screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-invitations--import-from-group");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  // Animated bounding rectangles can differ by a fraction of a CSS pixel.
  expect(bounds.x).toBeGreaterThanOrEqual(-.5);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390.5);
  expect(bounds.height).toBeLessThanOrEqual(844.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await dialog.getByRole("checkbox", { name: "Select Priya Lim" }).uncheck();
  await dialog.getByRole("button", { name: "Invite 2 members", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("2 invitations sent (simulated).");
});

test("participant pages fit supported widths without horizontal document scrolling", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/storybook/iframe.html?viewMode=story&id=sessions-player-management--${theme}`);
      await expect(page.getByRole("heading", { name: "Tennis Court Booking" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${theme} at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
});

test("light group choices and Cancel retain readable contrast on real pointer hover", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T04:00:00Z"));
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-management--light");
  await page.getByRole("button", { name: "Import from group", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (const button of [dialog.getByRole("button", { name: /Badminton Club/ }), dialog.getByRole("button", { name: "Cancel", exact: true })]) {
    await button.hover();
    const ratio = await button.evaluate((element) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
      };
      const ink = luminance(getComputedStyle(element.querySelector("strong") ?? element).color);
      const surface = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(ink, surface) + .05) / (Math.min(ink, surface) + .05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test("tabs fit without horizontal clipping or scrollbar on MacBook Air narrow desktop screens", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/storybook/iframe.html?viewMode=story&id=sessions-player-management--${theme}`);
      const tabs = page.getByRole("tablist", { name: "Participant status" });
      await expect(tabs).toBeVisible();
      await expect(page.getByRole("tab", { name: "Invitations (0)" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import from group", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Invite player", exact: true })).toBeVisible();
      const scrollable = await tabs.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
      }));
      expect(scrollable.scrollbarWidth).toBe("none");
      expect(scrollable.scrollWidth, `${theme} tabs at ${width}px`).toBeLessThanOrEqual(scrollable.clientWidth + 2);
    }
  }
});

test("dialogs conceal browser scrollbars", async ({ page }) => {
  await page.goto("/storybook/iframe.html?viewMode=story&id=sessions-player-invitations--invite-by-user-id");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const scrollbarWidth = await dialog.evaluate((element) => getComputedStyle(element).scrollbarWidth);
  expect(scrollbarWidth).toBe("none");
});
