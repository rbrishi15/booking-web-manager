import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Runs every story in /components/ui as a test in a real (headless) Chromium browser:
 * each story must render, its play() checks must pass, and it must have no accessibility errors.
 * Kept separate from `npm test` so CI and the unit tests don't need a browser.
 */
export default defineConfig({
  plugins: [storybookTest({ configDir: path.join(__dirname, ".storybook") })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    name: "storybook",
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});