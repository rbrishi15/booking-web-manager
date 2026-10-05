import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint();

async function architectureMessages(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result!.messages.filter((message) => message.ruleId === "architecture/inward-dependencies");
}

describe("core dependency direction", () => {
  test.each([
    ["domain/accounts/example.ts", 'export { value } from "@/lib/example";'],
    ["domain/accounts/example.ts", 'export { value } from "../../app/example";'],
    ["domain/accounts/example.ts", 'export type { Value } from "@/use-cases/shared/contracts";'],
    ["domain/accounts/example.ts", 'export { value } from "next/headers";'],
    ["use-cases/accounts/example.ts", 'export { value } from "@/use-case-config/example";'],
    ["use-cases/accounts/example.ts", 'export { value } from "../../lib/example";'],
    ["use-cases/accounts/example.ts", 'export { value } from "@supabase/supabase-js";'],
    ["domain/accounts/example.ts", 'export * from "@/domain/../../lib/example";'],
    ["domain/accounts/example.ts", 'export const value = import("@/lib/example");'],
    ["domain/accounts/example.ts", 'export const value = require("@/lib/example");'],
    ["domain/accounts/example.ts", 'export type Value = import("@/lib/example").Value;'],
    ["domain/accounts/example.ts", 'import value = require("@/lib/example"); export { value };'],
    ["domain/accounts/example.ts", 'export const load = (name: string) => import(name);'],
  ])("rejects an outward or unverifiable dependency in %s: %s", async (filePath, source) => {
    expect(await architectureMessages(filePath, source)).toHaveLength(1);
  });

  test.each([
    ["domain/accounts/example.ts", 'export { Money } from "../finance/money";'],
    ["domain/accounts/example.ts", 'export { Money } from "@/domain/finance/money";'],
    ["use-cases/accounts/example.ts", 'export { User } from "../../domain/accounts/user";'],
    ["use-cases/accounts/example.ts", 'export type { Clock } from "../shared/contracts";'],
    ["use-cases/accounts/example.ts", 'export const value = import("@/domain");'],
    ["lib/example.ts", 'export { value } from "pg";'],
    ["use-case-config/example.ts", 'export { value } from "@/app/example";'],
  ])("allows an inward dependency or outer adapter in %s: %s", async (filePath, source) => {
    expect(await architectureMessages(filePath, source)).toHaveLength(0);
  });
});
