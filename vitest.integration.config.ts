import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
