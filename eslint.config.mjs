import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import inwardDependencies from "./scripts/eslint/core-dependencies.mjs";
import configPersistence from "./scripts/eslint/config-persistence.mjs";
import apiAuthentication from "./scripts/eslint/api-authentication.mjs";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "lib/database.types.ts",
      "next-env.d.ts",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "storybook-static/**",
      "public/storybook/**",
      "output/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{cjs,js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "never", prev: "import", next: "import" },
      ],
    },
  },
  {
    files: ["domain/**/*.{ts,tsx,mts,cts}", "use-cases/**/*.{ts,tsx,mts,cts}"],
    plugins: { architecture: { rules: { "inward-dependencies": inwardDependencies } } },
    rules: { "architecture/inward-dependencies": "error" },
  },
  {
    files: ["use-case-config/**/*.{ts,tsx,mts,cts}"],
    plugins: { architecture: { rules: { "no-config-persistence": configPersistence } } },
    rules: { "architecture/no-config-persistence": "error" },
  },
  {
    files: ["app/**/route.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"],
    plugins: { architecture: { rules: { "api-authentication": apiAuthentication } } },
    rules: { "architecture/api-authentication": "error" },
  },
  {
    files: ["**/*.test.ts"],
    languageOptions: {
      globals: globals.vitest,
    },
  },
);
