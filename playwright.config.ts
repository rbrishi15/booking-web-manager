import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
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
    url: "http://127.0.0.1:3100/api/openapi",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
