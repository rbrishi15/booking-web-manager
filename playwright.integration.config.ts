import { defineConfig } from "@playwright/test";
import { sessionTestEnvironment } from "./tests/support/session-test-context";

sessionTestEnvironment();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/session-api.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "off" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/openapi",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
