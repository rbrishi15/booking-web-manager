import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "narrow mobile", width: 320, height: 740 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

async function continueRegistration(page: Page) {
  await page.getByLabel("Region", { exact: true }).selectOption("West");
  await page.getByLabel("Email", { exact: true }).fill("jamie@example.test");
  await page.getByLabel("Password", { exact: true }).fill("A-draft-password");
  await page.getByRole("button", { name: /^sign up$/i }).click();
  await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
}

async function continueToUserId(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("Jamie Tan");
  await page.getByLabel("Preferred sport", { exact: true }).selectOption("Tennis");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your user ID", exact: true })).toBeVisible();
  await expect(page.getByLabel("User ID", { exact: true })).toBeFocused();
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} authentication pages`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("UC1-01 registration presents account details, profile and user ID, and preserves them when going back", async ({ page }) => {
      await page.goto("/register");

      await expect(page.getByRole("heading", { name: "Register", exact: true })).toBeVisible();
      for (const label of ["Region", "Email", "Password"]) {
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      }
      await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
      await expect(page.getByLabel("Preferred sport", { exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await continueRegistration(page);
      await expect(page.getByRole("link", { name: "Terms", exact: true })).toBeHidden();
      await continueToUserId(page);
      await page.getByLabel("User ID", { exact: true }).fill("Jamie_Tan");
      await expect(page.getByLabel("User ID", { exact: true })).toHaveAccessibleDescription(/Other players find you with it, like a Telegram username/);
      await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
      await expect(page.getByRole("link", { name: "Privacy Policy", exact: true })).toHaveAttribute("href", "/privacy");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.getByRole("button", { name: "Back to your profile", exact: true }).click();
      await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Jamie Tan");
      await page.getByRole("button", { name: "Back to account details", exact: true }).click();
      await expect(page.getByLabel("Region", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Region", { exact: true })).toHaveValue("West");
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("jamie@example.test");
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue("A-draft-password");
      await page.getByRole("button", { name: /^sign up$/i }).click();
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Jamie Tan");
      await expect(page.getByLabel("Preferred sport", { exact: true })).toHaveValue("Tennis");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByLabel("User ID", { exact: true })).toHaveValue("Jamie_Tan");

      await page.locator('a[href="/login"]:visible').last().click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
    });

    test("UC1-02 login fits the viewport and links to registration", async ({ page }) => {
      await page.goto("/login");

      await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^log in$/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.locator('a[href="/register"]:visible').last().click();
      await expect(page).toHaveURL(/\/register$/);
      await expect(page.getByRole("heading", { name: "Register", exact: true })).toBeVisible();
    });
  });
}

for (const route of ["login", "register"]) {
  test(`${route} password visibility preserves the value while editing`, async ({ page }) => {
    await page.goto(`/${route}`);
    const password = page.getByLabel("Password", { exact: true });

    await password.fill("A-draft-password");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("A-draft-password");

    await password.fill("An-edited-password");
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("An-edited-password");
  });
}

test("UC1-01 invalid account details stay on the first step with accessible errors", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Region", { exact: true }).selectOption("West");
  await page.getByLabel("Email", { exact: true }).fill("unfinished-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: /^sign up$/i }).click();

  await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAccessibleDescription("Enter a valid email address");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription(/Use at least 8 characters/);
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("West");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("unfinished-email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("short");
  await expect(page.getByRole("button", { name: /^sign up$/i })).toBeEnabled();
});

test("UC1-01 email endings preserve full addresses and survive navigation between steps", async ({ page }) => {
  await page.goto("/register");
  const email = page.getByLabel("Email", { exact: true });
  const ending = page.getByRole("combobox", { name: "Email ending", exact: true });
  const password = page.getByLabel("Password", { exact: true });

  await email.fill("jamie@subdomain.school.edu.sg");
  await password.focus();
  await expect(email).toHaveValue("jamie@subdomain.school.edu.sg");
  await expect(ending).toHaveValue("");
  expect(await page.evaluate(() => new FormData(document.forms[0]).get("email"))).toBe("jamie@subdomain.school.edu.sg");

  await email.fill("jamie@example.com");
  await password.focus();
  await expect(email).toHaveValue("jamie@example");
  await expect(ending).toHaveValue(".com");
  expect(await page.evaluate(() => new FormData(document.forms[0]).get("email"))).toBe("jamie@example.com");

  await ending.selectOption(".net");
  expect(await page.evaluate(() => new FormData(document.forms[0]).get("email"))).toBe("jamie@example.net");
  await password.fill("A-draft-password");
  await page.getByRole("button", { name: /^sign up$/i }).click();
  await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^back/i }).click();

  await expect(email).toHaveValue("jamie@example");
  await expect(ending).toHaveValue(".net");
  expect(await page.evaluate(() => new FormData(document.forms[0]).get("email"))).toBe("jamie@example.net");
});

test("UC1-01 an incomplete profile stays on the profile step with accessible errors", async ({ page }) => {
  await page.goto("/register");
  await continueRegistration(page);
  await page.getByLabel("Name", { exact: true }).fill("Jamie Tan");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByText("Please fix the highlighted fields.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preferred sport", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Preferred sport", { exact: true })).toHaveAccessibleDescription("Choose a sport");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Jamie Tan");
  await expect(page.getByLabel("User ID", { exact: true })).toBeHidden();
});

test("UC1-01 the user ID step explains each rule before anything is submitted", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
  await page.goto("/register");
  await continueRegistration(page);
  await continueToUserId(page);
  const userId = page.getByLabel("User ID", { exact: true });

  for (const [typed, rule] of [
    ["jam", "Use at least 5 characters"],
    ["9lives", "Start with a letter"],
    ["jamie.tan", "Use only letters, numbers and underscores"],
    ["jamie__tan", "Don't end with or repeat an underscore"],
  ] as const) {
    await userId.fill(typed);
    await expect(userId).toHaveAttribute("aria-invalid", "true");
    await expect(userId).toHaveAccessibleDescription(new RegExp(rule));
  }
  await page.getByRole("button", { name: "Create account", exact: true }).click();

  await expect(page.getByText("Please fix the highlighted fields.", { exact: true })).toBeVisible();
  await expect(userId).toHaveValue("jamie__tan");
  expect(posts.filter((pathname) => pathname === "/register")).toEqual([]);
});

test("UC1-01 a failed sign-up keeps every step of the draft", async ({ page }) => {
  // The dummy Supabase URL refuses connections, so the valid submission fails without creating an account.
  await page.goto("/register");
  await continueRegistration(page);
  await continueToUserId(page);
  const userId = page.getByLabel("User ID", { exact: true });
  await userId.fill("@Jamie_Tan");
  // Without database settings the live check cannot run; the sign-up trigger still keeps IDs unique.
  await expect(userId).toHaveAccessibleDescription(/We couldn't check this ID now/);
  const [response] = await Promise.all([
    page.waitForResponse((result) => result.request().method() === "POST" && new URL(result.url()).pathname === "/register"
      && result.request().postData()?.includes("Jamie_Tan") === true),
    page.getByRole("button", { name: "Create account", exact: true }).click(),
  ]);

  expect(response.ok()).toBe(true);
  await expect(page.getByText("We couldn't create your account. Please try again.", { exact: true })).toBeVisible();
  await expect(userId).toHaveValue("Jamie_Tan");
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Back to your profile", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Jamie Tan");
  await expect(page.getByLabel("Preferred sport", { exact: true })).toHaveValue("Tennis");
  await page.getByRole("button", { name: "Back to account details", exact: true }).click();
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("West");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("jamie@example.test");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("A-draft-password");
});

test("UC1-02 server validation preserves credentials and the intended destination", async ({ page }) => {
  const next = "/sessions?view=mine";
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill("unfinished-email");
  await page.getByLabel("Password", { exact: true }).fill("A-draft-password");
  await page.getByRole("button", { name: /^log in$/i }).click();

  await expect(page.getByText("Please fix the highlighted fields.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAccessibleDescription("Enter a valid email address");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("unfinished-email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("A-draft-password");
  await expect(page.locator('input[type="hidden"][name="next"]')).toHaveValue(next);
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeEnabled();
});

test("UC1-02 login retains account deletion and email-link recovery notices", async ({ page }) => {
  await page.goto("/login?deleted=1");
  await expect(page.getByRole("status")).toHaveText("Your account has been deleted.");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();

  await page.goto("/login?verification=failed");
  await expect(page.getByRole("status")).toContainText("We couldn't finish signing you in from that email link.");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeEnabled();
});

// Defect D1: a submission before hydration used the browser default (GET), copying the password into the URL.
for (const { route, useCase, submit } of [
  { route: "login", useCase: "UC1-02", submit: /^log in$/i },
  { route: "register", useCase: "UC1-01", submit: /^sign up$/i },
] as const) {
  test.describe(`${route} before JavaScript loads`, () => {
    test.use({ javaScriptEnabled: false });

    test(`${useCase} ${route} posts the form and keeps the password out of the URL`, async ({ page }) => {
      const password = "A-draft-password";
      await page.goto(`/${route}?next=%2Fgroups`);
      await page.getByLabel("Email", { exact: true }).fill("jamie@example.test");
      await page.getByLabel("Password", { exact: true }).fill(password);

      const submission = page.waitForRequest((request) => request.isNavigationRequest() && request.frame() === page.mainFrame());
      await page.getByRole("button", { name: submit }).click();
      const request = await submission;

      expect(request.method()).toBe("POST");
      expect(request.url()).not.toContain(password);
      await page.waitForLoadState();
      expect(page.url()).not.toContain(password);
      expect(page.url()).not.toContain("password=");
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
      await expect(page.locator('input[type="hidden"][name="next"]')).toHaveValue("/groups");
    });
  });
}
