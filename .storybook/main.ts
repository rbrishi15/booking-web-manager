import type { StorybookConfig } from "@storybook/nextjs-vite";

/** Shared design system and independently renderable feature views. */
const config: StorybookConfig = {
  stories: ["../components/**/*.mdx", "../components/**/*.stories.@(ts|tsx)", "../app/**/*.stories.@(ts|tsx)"],
  // Never copy all of public: it contains the previously staged Storybook build.
  staticDirs: [
    { from: "../public/images", to: "/images" },
    { from: "../public/fonts", to: "/fonts" },
  ],
  viteFinal(config) {
    // Vite otherwise copies the entire Next public directory independently of staticDirs,
    // including the previous public/storybook deployment on the second build.
    return { ...config, publicDir: false, build: { ...config.build, copyPublicDir: false } };
  },
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
};

export default config;
