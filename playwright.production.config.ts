import { defineConfig } from "@playwright/test";

const baseURL = process.env.PRODUCTION_URL || "https://booking-web-manager.vercel.app";

if (!baseURL.startsWith("https://")) {
  throw new Error("PRODUCTION_URL must use HTTPS");
}

export default defineConfig({
  testDir: "./tests/production",
  timeout: 20_000,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["github"]],
  use: { baseURL },
});
