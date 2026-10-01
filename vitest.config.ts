import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Two test projects:
 * - "unit": the domain, use-case and lib tests in Node (what `npm test` and CI run; no browser needed).
 * - "storybook": every story in /components/ui rendered in headless Chromium, with its play() checks
 *   and accessibility checks (`npm run test:storybook`, and Storybook's own "Run tests" button).
 * Storybook's button reads this file, so the Storybook project has to be registered here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules", ".next"],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(__dirname, ".storybook") })],
        // Pre-bundle every package the components and stories import, so Vite never has to stop and
        // reload the test browser mid-run when a story uses a package for the first time (that reload
        // makes tests fail with "Failed to fetch dynamically imported module"). Add new packages here.
        optimizeDeps: {
          include: [
            "@radix-ui/react-checkbox",
            "@radix-ui/react-dialog",
            "@radix-ui/react-label",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
            "@storybook/addon-themes",
            "class-variance-authority",
            "clsx",
            "lucide-react",
            "next-themes",
            "sonner",
            "tailwind-merge",
          ],
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
      },
    ],
  },
});
