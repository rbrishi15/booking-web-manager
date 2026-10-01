import type { StorybookConfig } from "@storybook/nextjs-vite";

/** Storybook for the shared design system in /components/ui (owner: Joseph). */
const config: StorybookConfig = {
  stories: ["../components/**/*.mdx", "../components/**/*.stories.@(ts|tsx)", "../app/discover/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
};

export default config;
