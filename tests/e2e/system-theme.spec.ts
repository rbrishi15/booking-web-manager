import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`applies the device's ${colorScheme} theme across pages and reloads`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => hydrationErrors.push(error.message));

    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(colorScheme);
    await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      colorScheme === "dark" ? "rgb(3, 7, 18)" : "rgb(246, 247, 249)",
    );

    await page.getByRole("link", { name: "Browse sessions", exact: true }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.locator("html")).toHaveClass(colorScheme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(colorScheme);
    await expect(page.getByRole("searchbox", { name: "Search sports or venues" })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });

  test(`initializes the ${colorScheme} theme before hydration`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    // The inline bootstrap must apply the theme even before React bundles load.
    await page.route("**/_next/**/*.js", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(colorScheme);
    await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
  });
}

test("responds to device theme changes while the page stays open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/discover");
  const search = page.getByRole("searchbox", { name: "Search sports or venues" });
  await search.fill("Tennis");
  await expect(page.locator("html")).toHaveClass("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(search).toHaveValue("Tennis");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass("light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(search).toHaveValue("Tennis");
});
