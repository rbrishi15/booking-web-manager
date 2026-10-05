import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import inwardDependencies from "./scripts/eslint/core-dependencies.mjs";

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
    files: ["domain/**/*.{ts,tsx}", "use-cases/**/*.{ts,tsx}"],
    plugins: { architecture: { rules: { "inward-dependencies": inwardDependencies } } },
    rules: { "architecture/inward-dependencies": "error" },
  },
  {
    files: ["**/*.test.ts"],
    languageOptions: {
      globals: globals.vitest,
    },
  },
);
