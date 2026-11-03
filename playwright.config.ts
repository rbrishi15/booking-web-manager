import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/session-api-unavailable.spec.ts", "**/api-documentation.spec.ts", "**/public-resources.spec.ts", "**/landing-page.spec.ts", "**/sessions-timeline.spec.ts", "**/storybook-session-participants.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "storybook-session-participants",
      testMatch: "**/storybook-session-participants.spec.ts",
      use: { trace: "retain-on-failure" },
    },
    {
      name: "sessions-timeline",
      testMatch: "**/sessions-timeline.spec.ts",
      use: { trace: "retain-on-failure" },
    },
    {
      name: "sessions-timeline-webkit",
      testMatch: "**/sessions-timeline.spec.ts",
      use: { browserName: "webkit", trace: "retain-on-failure" },
    },
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
    {
      name: "public-resources",
      testMatch: "**/public-resources.spec.ts",
      use: { trace: "retain-on-failure" },
    },
    {
      name: "landing-page",
      testMatch: "**/landing-page.spec.ts",
      // Headless shell can miss background-tab events while tracing on Linux.
      use: { channel: "chromium", trace: "retain-on-failure" },
    },
    {
      name: "landing-page-webkit",
      testMatch: "**/landing-page.spec.ts",
      use: { browserName: "webkit", trace: "retain-on-failure" },
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
