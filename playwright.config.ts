import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/session-api-unavailable.spec.ts", "**/api-documentation.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "session-api-unavailable",
      testMatch: "**/session-api-unavailable.spec.ts",
      use: { trace: "off" },
    },
    {
      name: "api-documentation",
      testMatch: "**/api-documentation.spec.ts",
      use: { trace: "retain-on-failure" },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    env: { DATABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
    url: "http://127.0.0.1:3100/api/openapi",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
