import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/auth-pages.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: "test-results/auth",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/auth" }]],
  use: { baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  webServer: {
    // Compile with dummy settings: public environment values are embedded by Next.js.
    // Run separately from production-build tests because both write to .next.
    command: "npx next dev --hostname 127.0.0.1 --port 3101",
    env: {
      DATABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "auth-page-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
    // Anonymous getUser resolves without a session or external request. Tests only
    // submit invalid input, so no account creation or sign-in service is used.
    url: "http://127.0.0.1:3101/login",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
