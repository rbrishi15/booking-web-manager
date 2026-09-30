import type { StorybookConfig } from "@storybook/nextjs-vite";

/** Storybook for the shared design system in /components/ui (owner: Joseph). */
const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
};

export default config;